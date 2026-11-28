"""Assemble reviewed full rectangular decks on simple vertical line bearings."""
import math

from deck_mesh import frame_plan_point


def assemble_rectangular_decks(model, decks):
    nodes = list(model["nodes"])
    elements = [dict(el) for el in model["elements"]]
    plates, bearings, ledger = [], [], []
    if not decks or len(decks)>48:
        raise ValueError("A bounded set of reviewed structural decks is required")
    for deck in decks:
        bounds = deck["boundsMm"]
        xs = {bounds["minX"],bounds["maxX"]}
        ys = {bounds["minY"],bounds["maxY"]}
        edges = []
        for index in deck["supportingBeamElementIndices"]:
            element = elements[index]
            start,end = (element[k] for k in ("startNodeIndex","endNodeIndex"))
            a,b = [frame_plan_point(nodes[i]) for i in (start,end)]
            if any(abs(nodes[i]["positionM"][2]*1000-deck["topMm"])>1e-6 for i in (start,end)):
                raise ValueError("Bearing beam is outside the registered analytical level")
            if not ((a[0]==b[0] and a[0] in (bounds["minX"],bounds["maxX"])) or
                    (a[1]==b[1] and a[1] in (bounds["minY"],bounds["maxY"]))):
                raise ValueError("Reviewed rectangle requires transverse boundary beam axes")
            xs.update((a[0],b[0]))
            ys.update((a[1],b[1]))
            edges.append((a,b,start,end,element))
        def refine(axis):
            stations=sorted(axis)
            values=[]
            for a,b in zip(stations,stations[1:]):
                n=math.ceil((b-a)/500.)
                if n<1 or n+len(values)>512:
                    raise ValueError("Reviewed deck refinement budget exceeded")
                values.extend(a+(b-a)*i/n for i in range(n))
            return values+[stations[-1]]
        xaxis,yaxis=refine(xs),refine(ys)
        if (len(xaxis)-1)*(len(yaxis)-1)+len(plates)>12000:
            raise ValueError("Building exceeds the coupled quad budget")
        grid={}
        for j,y in enumerate(yaxis):
            for i,x in enumerate(xaxis):
                z=deck["topMm"]/1000
                perimeter = i in (0,len(xaxis)-1) or j in (0,len(yaxis)-1)
                master=None
                if perimeter:
                    endpoint_ids=set()
                    interiors=[]
                    for a,b,start,end,element in edges:
                        if (x,y)==a: endpoint_ids.add(start)
                        elif (x,y)==b: endpoint_ids.add(end)
                        elif (min(a[0],b[0])<=x<=max(a[0],b[0]) and min(a[1],b[1])<=y<=max(a[1],b[1])):
                            interiors.append(element)
                    if len(endpoint_ids)==1 and not interiors:
                        master=endpoint_ids.pop()
                    elif not endpoint_ids and len(interiors)==1:
                        master=len(nodes)
                        nodes.append(dict(index=master,id=f"{deck['id']}/beam/{i}/{j}",positionM=[x/1000,-y/1000,z]))
                        interiors[0].setdefault("interiorNodeIndices",[]).append(master)
                    else:
                        raise ValueError("Ambiguous or incomplete structural bearing station")
                slave=len(nodes)
                grid[i,j]=slave
                nodes.append(dict(index=slave,id=f"{deck['id']}/plate/{i}/{j}",
                                  positionM=[x/1000,-y/1000,z-deck["thicknessMm"]/2000],
                                  restraint=[i==0 and j==0,j==0 and i in (0,len(xaxis)-1),False,False,False,False]))
                if master is not None:
                    bearings.append(dict(masterNodeIndex=master,slaveNodeIndex=slave,reference=deck["reference"]))
        count=0
        for j in range(len(yaxis)-1):
            for i in range(len(xaxis)-1):
                plates.append(dict(id=f"{deck['id']}/Q/{i}/{j}",kind="QUAD",
                                   nodeIndices=[grid[i,j],grid[i,j+1],grid[i+1,j+1],grid[i+1,j]],
                                   thicknessM=deck["thicknessMm"]/1000,elasticityKPa=deck["elasticityKPa"],
                                   poissonRatio=.2,surfacePressuresByCase={k:-v for k,v in deck["pressures"].items()}))
                count+=1
        area=(xaxis[-1]-xaxis[0])*(yaxis[-1]-yaxis[0])/1e6
        ledger.append(dict(physicalSlabId=deck["id"],areaM2=area,quads=count,reference=deck["reference"],
                           forceKn={k:area*v for k,v in deck["pressures"].items()}))
    return dict(model=dict(model,nodes=nodes,elements=elements),plateElements=plates,verticalBearings=bearings),ledger
