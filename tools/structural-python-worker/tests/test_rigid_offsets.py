from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker_main import run_pynite_solve


@pytest.mark.parametrize("offset", [-.3,.3])
def test_offset_tip_force_and_virtual_work(offset):
    # Axial force at a height e induces the free-end couple e*P.
    points=[[0,0,0],[4,0,0],[4,0,offset]]
    nodes=[dict(index=i,id=str(i),positionM=p,restraint=[i==0]*6) for i,p in enumerate(points)]
    section=dict(areaM2=.08,elasticityKPa=25e6,shearModulusKPa=10e6,
                 momentInertiaYM4=.001,momentInertiaZM4=.002,torsionalConstantM4=.001)
    case=dict(id="G",name="axial",nodalLoads=[dict(nodeIndex=2,vectorKnM=[10,0,0,0,0,0])])
    model=dict(modelId="offset",nodes=nodes,elements=[dict(id="B",index=0,startNodeIndex=0,endNodeIndex=1,section=section)],
               loadCases=[case],combinations=[])
    result=run_pynite_solve(dict(model=model,rigidOffsets=[dict(masterNodeIndex=1,slaveNodeIndex=2,reference="tip fixture")]))
    assert result["ok"], result
    sol=result["envelope"]["loadCaseResults"]["G"]
    rotation=10*offset*4/(25e6*.001)
    assert sol["displacements"][1]["rotationRad"][1] == pytest.approx(rotation,abs=1e-10)
    assert sol["displacements"][2]["translationM"][0] == pytest.approx(10*4/(25e6*.08)+offset*rotation,abs=1e-10)
    assert sol["reactions"][0]["reactionKnM"] == pytest.approx([-10,0,0,0,-10*offset,0],abs=1e-8)
    assert sol["diagnostics"]["constraintReducedResidual"] < 1e-7

def test_eccentric_frame_and_loaded_balcony_plate():
    # Synthetic 2 m by 1 m balcony. Two 0.8 m steel cantilevers at the root
    # carry an independent plate midsurface 0.25 m above their centroids.
    points = [(-.8,0,0),(-.8,1,0),(0,0,0),(0,1,0),(0,0,.25),(2,0,.25),(2,1,.25),(0,1,.25)]
    nodes = [dict(id=str(i),index=i,positionM=p,restraint=[i<2]*6) for i,p in enumerate(points)]
    section = dict(areaM2=.02,elasticityKPa=200e6,shearModulusKPa=77e6,
                   momentInertiaYM4=.0001,momentInertiaZM4=.0002,torsionalConstantM4=.00008)
    beams = [dict(id=str(i),index=i,startNodeIndex=i,endNodeIndex=i+2,section=section) for i in range(2)]
    plate = dict(id="balcony",kind="QUAD",nodeIndices=[4,5,6,7],thicknessM=.1,
                 elasticityKPa=25e6,poissonRatio=.2,surfacePressuresByCase={"G":-3.})
    case = dict(id="G",name="pressure and in-plane force",nodalLoads=[
        dict(nodeIndex=i,vectorKnM=[2,0,0,0,0,0]) for i in (5,6)])
    links = [dict(masterNodeIndex=m,slaveNodeIndex=s,reference="synthetic rigid root")
             for m,s in ((2,4),(3,7))]
    result = run_pynite_solve(dict(model=dict(modelId="synthetic-balcony",nodes=nodes,elements=beams,
                                  loadCases=[case],combinations=[]),plateElements=[plate],rigidOffsets=links))
    assert result["ok"], result
    sol = result["envelope"]["loadCaseResults"]["G"]
    reactions = [r["reactionKnM"] for r in sol["reactions"]]
    assert sum(r[0] for r in reactions) == pytest.approx(-4,abs=1e-8)
    assert sum(r[2] for r in reactions) == pytest.approx(6,abs=1e-8)
    assert sum(r[4] for r in reactions) == pytest.approx(-(6*1.8+4*.25),abs=1e-8)
    assert sol["equilibrium"]["isEquilibrated"]

def test_simple_vertical_bearings_transfer_pressure_and_allow_independent_rotations():
    # A 4 m by 1 m one-way strip on six grounded posts. Slave nodes retain
    # independent rotations. Small membrane gauges suppress in-plane rigid modes.
    from test_distributed_gravity import make_strip, LENGTH, WIDTH, PRESSURE, THICKNESS, ELASTIC
    nx = 16
    nodes, _, plates = make_strip(nx, lambda i,j: [i==0 and j==0,i in (0,nx) and j==0,False,False,False,False], False)
    beams, links = [], []
    section = dict(areaM2=.1,elasticityKPa=30e6,shearModulusKPa=12e6,
                   momentInertiaYM4=.001,momentInertiaZM4=.001,torsionalConstantM4=.001)
    for j in range(3):
        for i in (0,nx):
            s=j*(nx+1)+i
            x,y,_=nodes[s]["positionM"]
            m=len(nodes)
            for k,z in enumerate((-.2,-1.2)):
                nodes.append(dict(id=f"B{m+k}",index=m+k,positionM=[x,y,z],restraint=[k==1]*6))
            beams.append(dict(id=f"C{m}",index=len(beams),startNodeIndex=m+1,endNodeIndex=m,section=section))
            links.append(dict(masterNodeIndex=m,slaveNodeIndex=s,reference="synthetic vertical line bearing"))
    payload=dict(model=dict(modelId="simple-bearing",nodes=nodes,elements=beams,loadCases=[dict(id="G")],combinations=[]),
                 verticalBearings=links,plateElements=plates)
    result=run_pynite_solve(payload)
    assert result["ok"], result
    sol=result["envelope"]["loadCaseResults"]["G"]
    reactions=sol["reactions"]
    for x in (0,LENGTH):
        assert sum(r["reactionKnM"][2] for r in reactions if nodes[r["nodeIndex"]]["positionM"][0]==x) == pytest.approx(
            PRESSURE*WIDTH*LENGTH/2,abs=1e-7)
    assert max(abs(r["reactionKnM"][4]) for r in reactions)<1e-7
    expected=-5*PRESSURE*LENGTH**4/(384*ELASTIC*THICKNESS**3/12)
    mid=sol["displacements"][nx+1+nx//2]["translationM"][2]
    assert mid == pytest.approx(expected,rel=.03)
    assert sol["diagnostics"]["verticalBearingCount"]==6


def test_hold_down_and_failure_of_local_equilibrium_in_slab_audit():
    from reviewed_rectangular_coupling import verify_slab_transfer
    # Three collinear stations in this audit-only synthetic fixture. The symmetric
    # end reactions balance the applied resultant even with central uplift.
    coupled = {"model":{"nodes":[{"id":str(i),"positionM":[i%3,0.,0.]} for i in range(6)],"combinations":[]},
               "verticalBearings":[{"physicalSlabId":"D","masterNodeIndex":i,"slaveNodeIndex":i+3} for i in range(3)]}
    ledger = [{"physicalSlabId":"D","centroidM":[1.,0.],"forceKn":{"G":5.}}]
    result = {"loadCaseResults":{"G":{"diagnostics":{"verticalBearingForcesKn":[3.,-1.,3.]}}},"combinationResults":{}}
    audit = verify_slab_transfer(coupled,ledger,result)[0]["bearingTransfer"]["case/G"]
    assert audit["requiresHoldDown"] and audit["minimumBearingReactionKn"] == -1.
    result["loadCaseResults"]["G"]["diagnostics"]["verticalBearingForcesKn"] = [2.,-1.,4.]
    with pytest.raises(ValueError,match="first moments"):
        verify_slab_transfer(coupled,ledger,result)

def test_one_sided_tip_bearing_releases_and_recloses_per_combination():
    # A horizontal cantilever meets a rigid stop at its free end. A downward
    # force is carried by the stop. Upward loading gives the free cantilever
    # solution. The combined case closes even though the upward case opened.
    points = [(0,0,0),(4,0,0),(4,0,-.1)]
    nodes = [dict(id=str(i),index=i,positionM=p,restraint=[i!=1]*6) for i,p in enumerate(points)]
    section = dict(areaM2=.08,elasticityKPa=25e6,shearModulusKPa=10e6,
                   momentInertiaYM4=.001,momentInertiaZM4=.001,torsionalConstantM4=.001)
    model = dict(modelId="tip-stop",nodes=nodes,elements=[dict(id="B",index=0,startNodeIndex=0,endNodeIndex=1,section=section)],
        loadCases=[dict(id=k,nodalLoads=[dict(nodeIndex=1,vectorKnM=[0,0,v,0,0,0])]) for k,v in (("up",3),("down",-5))],
        combinations=[dict(id="both",factors={"up":1,"down":1})])
    result = run_pynite_solve(dict(model=model,verticalBearings=[dict(masterNodeIndex=2,slaveNodeIndex=1,reference="synthetic stop")],
                                  compressionOnlyBearings=True))["envelope"]
    up=result["loadCaseResults"]["up"]
    assert up["diagnostics"]["verticalContact"]["openIndices"]==[0]
    assert up["displacements"][1]["translationM"][2]==pytest.approx(3*4**3/(3*25e6*.001),abs=1e-10)
    assert up["diagnostics"]["verticalBearingForcesKn"]==pytest.approx([0],abs=1e-8)
    for case,force in ((result["loadCaseResults"]["down"],5),(result["combinationResults"]["both"],2)):
        assert not case["diagnostics"]["verticalContact"]["openIndices"]
        assert case["diagnostics"]["verticalBearingForcesKn"]==pytest.approx([force],abs=1e-8)
        assert case["displacements"][1]["translationM"][2]==pytest.approx(0,abs=1e-10)
