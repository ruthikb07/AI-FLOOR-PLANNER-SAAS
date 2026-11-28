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


def solve_rigid_offsets(fe, nodes, pairs):
    Analysis._prepare_model(fe)
    unknown, prescribed, values = Analysis._partition_D(fe)
    if np.any(values):
        raise ValueError("Nonzero prescribed displacement with offsets requires verification")
    slave_to_master = {slave:master for master,slave in pairs}
    independent = [i for i in range(len(nodes)) if i not in slave_to_master]
    compact = {idx:j for j,idx in enumerate(independent)}
    rows, cols, weights = [], [], []
    for i,node in enumerate(nodes):
        master = slave_to_master.get(i,i)
        col = 6*compact[master]
        for dof in range(6):
            rows.append(6*i+dof)
            cols.append(col+dof)
            weights.append(1.)
        if i != master:
            x,y,z = np.subtract(node["positionM"],nodes[master]["positionM"])
            # u_slave = u_master + theta_master cross r.
            for row,axis,coef in ((0,1,z),(0,2,-y),(1,0,-z),(1,2,x),(2,0,y),(2,1,-x)):
                if coef:
                    rows.append(6*i+row)
                    cols.append(col+3+axis)
                    weights.append(coef)
    transform = coo_matrix((weights,(rows,cols)),shape=(6*len(nodes),6*len(independent))).tocsr()
    stiffness = fe.Ke(next(iter(fe.load_combos)), check_stability=False, sparse=True).tocsr()
    reduced = (transform.T @ stiffness @ transform).tocsr()
    fixed = [6*compact[k//6]+k%6 for k in prescribed]
    free = np.setdiff1d(np.arange(reduced.shape[0]),fixed)
    kff = reduced[free][:,free]
    rxns = ("RxnFX","RxnFY","RxnFZ","RxnMX","RxnMY","RxnMZ")
    residuals = {}
    for key,combo in fe.load_combos.items():
        force = transform.T @ (fe.P(key)-fe.FER(key))
        reduced_u = np.zeros_like(force)
        if len(free):
            reduced_u[free] = Analysis._solve_unknown_disp(kff,force[free],True,True)
        full_u = transform @ reduced_u
        Analysis._store_displacements(fe, full_u[unknown], values, unknown, prescribed, combo)
        reaction = reduced @ reduced_u-force
        residuals[key] = float(np.linalg.norm(reaction[free]) / max(1., np.linalg.norm(force[free])))
        if not np.isfinite(full_u).all() or not np.isfinite(reaction).all() or residuals[key] > 1e-7:
            raise ValueError("Rigid offset equilibrium residual exceeds tolerance")
        for k,q in zip(prescribed,fixed):
            node = fe.nodes[f"N_{k//6}"]
            getattr(node,rxns[k%6])[key] = float(reaction[q,0])
    fe.solution = "Linear"
    return residuals
