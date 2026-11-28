"""First-order six-DOF rigid offsets in the pinned PyNite sparse equation system."""
import numpy as np
from scipy.sparse import coo_matrix
from Pynite import Analysis


def validate_offsets(nodes, links):
    masters, slaves, pairs = set(), set(), []
    for link in links:
        master, slave = link["masterNodeIndex"], link["slaveNodeIndex"]
        if (any(type(i) is not int or not 0 <= i < len(nodes) for i in (master, slave))
                or master == slave or slave in slaves or any(nodes[slave].get("restraint") or [])
                or not isinstance(link.get("reference"), str) or not link["reference"].strip()):
            raise ValueError("Invalid rigid offset nodes, support or review reference")
        masters.add(master)
        slaves.add(slave)
        pairs.append((master,slave))
    if masters & slaves:
        raise ValueError("Chained or cyclic rigid offsets require an independent master")
    return pairs


def validate_vertical_bearings(nodes, links, rigid_pairs):
    tied = {i for pair in rigid_pairs for i in pair}
    masters, slaves, pairs = set(), set(), []
    for link in links:
        m, s = link["masterNodeIndex"], link["slaveNodeIndex"]
        if (any(type(i) is not int or not 0 <= i < len(nodes) for i in (m,s)) or m == s
                or s in slaves or m in tied or s in tied or not isinstance(link.get("reference"), str)
                or not link["reference"].strip()):
            raise ValueError("Invalid reviewed vertical bearing identity")
        if (np.linalg.norm(np.subtract(nodes[m]["positionM"][:2],nodes[s]["positionM"][:2])) > 1e-9
                or (nodes[s].get("restraint") or [False]*6)[2]):
            raise ValueError("Vertical bearing requires aligned plan coordinates and a free slave vertical DOF")
        masters.add(m)
        slaves.add(s)
        pairs.append((m,s))
    if masters & slaves:
        raise ValueError("Chained vertical bearings are unsupported")
    return pairs


def _constraint_transform(nodes,pairs,vertical_pairs):
    # Index independent DOFs individually. A vertical-only bearing retains
    # independent horizontal translations and all three slab rotations.
    dependent = {6*s+d:6*m+d for m,s in pairs for d in range(6)}
    dependent.update({6*s+2:6*m+2 for m,s in vertical_pairs})
    ndof = 6*len(nodes)
    compact = {i:j for j,i in enumerate(i for i in range(ndof) if i not in dependent)}
    rows = list(range(ndof))
    cols = [compact[dependent.get(i,i)] for i in rows]
    weights = [1.]*ndof
    for master,slave in pairs:
        x,y,z = np.subtract(nodes[slave]["positionM"],nodes[master]["positionM"])
        for row,axis,coef in ((0,1,z),(0,2,-y),(1,0,-z),(1,2,x),(2,0,y),(2,1,-x)):
            if coef:
                rows.append(6*slave+row)
                cols.append(compact[6*master+3+axis])
                weights.append(coef)
    transform = coo_matrix((weights,(rows,cols)),shape=(ndof,len(compact))).tocsr()
    return transform, compact


def solve_rigid_offsets(fe, nodes, pairs, vertical_pairs=(), compression_only=False):
    Analysis._prepare_model(fe)
    unknown, prescribed, values = Analysis._partition_D(fe)
    if np.any(values):
        raise ValueError("Nonzero prescribed displacement with constraints requires verification")
    stiffness = fe.Ke(next(iter(fe.load_combos)), check_stability=False, sparse=True).tocsr()
    rxns = ("RxnFX","RxnFY","RxnFZ","RxnMX","RxnMY","RxnMZ")
    residuals, bearing_forces, contacts = {}, {}, {}
    for key,combo in fe.load_combos.items():
        full_force = fe.P(key)-fe.FER(key)
        active = set(range(len(vertical_pairs)))
        tried = set()
        for iteration in range(128):
            state = frozenset(active)
            if state in tried:
                raise ValueError("Vertical bearing contact active set cycled")
            tried.add(state)
            transform,compact = _constraint_transform(nodes,pairs,[vertical_pairs[i] for i in sorted(active)])
            reduced = (transform.T @ stiffness @ transform).tocsr()
            fixed = [compact[k] for k in prescribed]
            free = np.setdiff1d(np.arange(reduced.shape[0]),fixed)
            force = transform.T @ full_force
            reduced_u = np.zeros_like(force)
            if len(free):
                reduced_u[free] = Analysis._solve_unknown_disp(reduced[free][:,free],force[free],True,True)
            full_u = transform @ reduced_u
            reaction = reduced @ reduced_u-force
            residuals[key] = float(np.linalg.norm(reaction[free]) / max(1.,np.linalg.norm(force[free])))
            if not np.isfinite(full_u).all() or not np.isfinite(reaction).all() or residuals[key] > 1e-7:
                raise ValueError("Constraint equilibrium residual exceeds tolerance")
            full_residual = stiffness @ full_u - full_force
            forces = [float(full_residual[6*s+2,0]) for _,s in vertical_pairs]
            gaps = [float(full_u[6*s+2,0]-full_u[6*m+2,0]) for m,s in vertical_pairs]
            if not np.isfinite(forces).all() or not np.isfinite(gaps).all():
                raise ValueError("Nonfinite vertical bearing force or opening")
            if compression_only:
                penetrations = [i for i,g in enumerate(gaps) if i not in active and g < -1e-9]
                if penetrations:
                    active.add(min(penetrations,key=gaps.__getitem__))
                    continue
                tensile = [i for i in active if forces[i] < -1e-7]
                if tensile:
                    active.remove(min(tensile,key=forces.__getitem__))
                    continue
                if any(abs(forces[i])>1e-7 for i in range(len(forces)) if i not in active):
                    raise ValueError("Released bearing has a residual contact force")
                contacts[key] = dict(iterations=iteration+1,openIndices=sorted(set(range(len(forces)))-active),
                                     openingM=gaps)
            bearing_forces[key] = forces
            Analysis._store_displacements(fe, full_u[unknown], values, unknown, prescribed, combo)
            for k,q in zip(prescribed,fixed):
                getattr(fe.nodes[f"N_{k//6}"],rxns[k%6])[key] = float(reaction[q,0])
            break
        else:
            raise ValueError("Vertical bearing contact exceeded the iteration budget")
    fe.solution = "Linear"
    return residuals, bearing_forces, contacts
