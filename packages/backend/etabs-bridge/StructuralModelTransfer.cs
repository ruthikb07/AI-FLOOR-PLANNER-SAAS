using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ETABSv1;

namespace RHPlanner.EtabsBridge;

public static partial class Program
{
    static string NativeId(string kind, string id) => "RH_" + kind + "_" +
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id))).Substring(0, 16);
    static double Value(JsonElement e, string key) {
        var v = e.GetProperty(key).GetDouble();
        if (!double.IsFinite(v)) throw new BridgeError("INVALID_PROJECT", "Non-finite " + key);
        return v;
    }
    static JsonElement[] Items(JsonElement e, string key, int limit) {
        var a=e.GetProperty(key);
        if(a.ValueKind!=JsonValueKind.Array || a.GetArrayLength()>limit) throw new BridgeError("INVALID_PROJECT","Invalid "+key);
        return a.EnumerateArray().ToArray();
    }
    static void Info(string key, string value) => Check(Model.SetProjectInfo(key, value), "SetProjectInfo:" + key);
    static void Remember(string native, string source) => Info("RH_SOURCE_" + native, source);

    static object ImportStructural(JsonElement p)
    {
        // Typed backend validates geometry/review before dispatch. Recheck critical protocol invariants here.
        var u=p.GetProperty("units");
        if(p.GetProperty("schemaVersion").GetInt32()!=1 || Text(u,"length")!="mm" || Text(u,"force")!="N" ||
            Text(u,"mass")!="kg" || Text(u,"temperature")!="C") throw new BridgeError("INVALID_PROJECT","Expected schema 1 and mm/N/kg/C.");
        var review=p.GetProperty("exportReview");
        var scope=Text(review,"status");
        if(scope!="API_VERIFICATION_FIXTURE" && (scope!="ENGINEER_REVIEWED" || !new[]{"ENGINEER_APPROVED_FOR_ANALYSIS","ENGINEER_REVIEWED_MODEL_ONLY"}.Contains(Text(p,"reviewStatus"))))
            throw new BridgeError("INVALID_PROJECT","Explicit structural review is required.");
        var levels=Items(p,"levels",64).OrderBy(l=>Value(l,"elevationMm")).ToArray();
        var nodes=Items(p,"nodes",500); var materials=Items(p,"materials",128);
        var columns=Items(p,"columns",1000); var beams=Items(p,"beams",1000); var slabs=Items(p,"slabs",200);
        if(levels.Length<2 || Text(levels[0],"name")!="Base" || nodes.Length<2 || columns.Length==0 || materials.Length==0)
            throw new BridgeError("INVALID_PROJECT","Missing base/storeys/nodes/columns/materials.");
        if(scope!="API_VERIFICATION_FIXTURE") {
            if(!review.TryGetProperty("inputSha256",out var binding) || binding.GetString()?.Length!=64)
                throw new BridgeError("ENGINEERING_INPUTS_REQUIRED","Hash-bound input review is required.");
            if(Items(p,"loadCases",64).Length>0 && (Text(p,"reviewStatus")!="ENGINEER_APPROVED_FOR_ANALYSIS" || !p.TryGetProperty("engineeringInputs",out _)))
                throw new BridgeError("ENGINEERING_INPUTS_REQUIRED","Reviewed engineering basis is required.");
        }
        foreach(var m in materials) if(!new[]{"ISOTROPIC_NO_DESIGN","CONCRETE_EXPLICIT","REBAR_EXPLICIT"}.Contains(Text(m,"analysisModel")) || Value(m,"elasticModulusNPerMm2")<=0 ||
            Value(m,"massDensityKgPerM3")<=0 || Value(m,"poissonRatio")<=-1 || Value(m,"poissonRatio")>=0.5)
            throw new BridgeError("INVALID_PROJECT","Invalid explicit elastic material.");
        foreach(var f in columns.Concat(beams)) {
            var s=f.GetProperty("section");
            if(Text(s,"kind")!="RECTANGLE" || Value(s,"widthMm")<=0 || Value(s,"depthMm")<=0)
                throw new BridgeError("INVALID_PROJECT","Explicit rectangular section required.");
        }
        foreach(var s in slabs) if(Items(s,"openingNodeIds",200).Length!=0 || Value(s,"thicknessMm")<=0)
            throw new BridgeError("INVALID_PROJECT","Unsupported slab opening/thickness.");
        var source=Text(p,"sourceArchitecturalRevisionId");
        var sourceIds=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var e in levels.Concat(nodes).Concat(materials).Concat(columns).Concat(beams).Concat(slabs))
            if(!sourceIds.Add(Text(e,"id")) || Text(e,"sourceArchitecturalRevisionId")!=source)
                throw new BridgeError("INVALID_PROJECT","Duplicate ID or mismatched architectural revision.");
        NewModel(source,p.TryGetProperty("grid",out var requestedGrid)?requestedGrid:null,Value(levels[1],"elevationMm")-Value(levels[0],"elevationMm"),levels.Length-1);
        if(p.TryGetProperty("grid",out var grid)) {
            int gridCount=0;string[] gridNames=[];
            Check(Model.GridSys.GetNameList(ref gridCount,ref gridNames),"GridSys.GetNameList");
            if(gridCount!=1)throw new BridgeError("NATIVE_MISMATCH","Grid template must create exactly one Cartesian system.");
            string gridName=Text(grid,"name");
            if(gridNames[0]!=gridName)Check(Model.GridSys.ChangeName(gridNames[0],gridName),"GridSys.ChangeName");
            Check(Model.GridSys.SetGridSys(gridName,Value(grid,"originXMm"),Value(grid,"originYMm"),Value(grid,"rotationDeg")),"GridSys.SetGridSys");
        }
        Info("RH_PROJECT_ID",Text(p,"id")); Info("RH_ARCHITECTURAL_BUILDING_ID",Text(p,"architecturalBuildingId"));
        Info("RH_ARCHITECTURAL_REVISION",source); Info("RH_EXPORT_SCOPE",Items(p,"loadCases",64).Length>0?(scope=="API_VERIFICATION_FIXTURE"?"LOADED_FIXTURE_NO_DESIGN":"ANALYSIS_READY_NOT_ANALYZED"):"MODEL_ONLY_NO_DESIGN");
        Info("RH_REVIEW_SCOPE",scope); Info("RH_REVIEWER_ID",Text(review,"reviewerId")); Info("RH_REVIEWED_AT",Text(review,"reviewedAt"));
        foreach(var l in levels) Remember(NativeId("L",Text(l,"id")),Text(l,"id"));
        // ETABS has an implicit Base datum; SetStories_2 takes heights above it, bottom to top.
        int count=levels.Length-1;
        string[] names=levels.Skip(1).Select(l=>Text(l,"name")).ToArray();
        double[] heights=Enumerable.Range(1,count).Select(i=>Value(levels[i],"elevationMm")-Value(levels[i-1],"elevationMm")).ToArray();
        bool[] master=new bool[count], splice=new bool[count]; string[] similar=Enumerable.Repeat("None",count).ToArray();
        double[] spliceHeight=new double[count]; int[] color=Enumerable.Repeat(-1,count).ToArray();
        Check(Model.Story.SetStories_2(Value(levels[0],"elevationMm"),count,ref names,ref heights,ref master,ref similar,ref splice,ref spliceHeight,ref color),"Story.SetStories_2");
        // Remove the blank-template load definitions: never invent self-weight or loading.
        int n=0; string[] defaults=[];
        Check(Model.LoadCases.GetNameList(ref n,ref defaults),"LoadCases.GetNameList");
        foreach(var name in defaults) Check(Model.LoadCases.Delete(name),"LoadCases.Delete:"+name);
        n=0; defaults=[];
        Check(Model.LoadPatterns.GetNameList(ref n,ref defaults),"LoadPatterns.GetNameList");
        foreach(var name in defaults) Check(Model.LoadPatterns.Delete(name),"LoadPatterns.Delete:"+name);
        // ETABS restores Dead/Live if no pattern exists. Keep one explicit zero-weight, unloaded placeholder.
        Check(Model.LoadPatterns.Add("RH_MODEL_ONLY",eLoadPatternType.Other,0,false),"LoadPatterns.Add:RH_MODEL_ONLY");
        foreach(var m in materials) {
            string id=Text(m,"id"), name=NativeId("M",id);
            var model=Text(m,"analysisModel");

            Check(Model.PropMaterial.SetMaterial(name,model=="CONCRETE_EXPLICIT"?eMatType.Concrete:model=="REBAR_EXPLICIT"?eMatType.Rebar:eMatType.NoDesign),"PropMaterial.SetMaterial:"+id);
            Check(Model.PropMaterial.SetMPIsotropic(name,Value(m,"elasticModulusNPerMm2"),Value(m,"poissonRatio"),Value(m,"thermalExpansionPerC")),"PropMaterial.SetMPIsotropic:"+id);
            // kg/m3 -> (N*s2/mm)/mm3 = kg/m3 / 1e12.
            Check(Model.PropMaterial.SetWeightAndMass(name,2,Value(m,"massDensityKgPerM3")/1e12),"PropMaterial.SetWeightAndMass:"+id);
            if(model=="CONCRETE_EXPLICIT") {
                var c=m.GetProperty("concrete");
                Check(Model.PropMaterial.SetOConcrete_1(name,Value(c,"compressiveStrength"),c.GetProperty("lightweight").GetBoolean(),Value(c,"lightweightFactor"),
                    c.GetProperty("stressStrainType").GetInt32(),c.GetProperty("hysteresisType").GetInt32(),Value(c,"strainAtStrength"),Value(c,"ultimateStrain"),Value(c,"finalSlope"),Value(c,"frictionAngle"),Value(c,"dilatationalAngle")),"PropMaterial.SetOConcrete_1:"+id);
            }
            if(model=="REBAR_EXPLICIT") {
                var c=m.GetProperty("reinforcement");
                Check(Model.PropMaterial.SetORebar_1(name,Value(c,"yieldStrength"),Value(c,"ultimateStrength"),Value(c,"expectedYieldStrength"),Value(c,"expectedUltimateStrength"),
                    c.GetProperty("stressStrainType").GetInt32(),c.GetProperty("hysteresisType").GetInt32(),Value(c,"hardeningStrain"),Value(c,"ultimateStrain"),Value(c,"finalSlope"),false),"PropMaterial.SetORebar_1:"+id);
            }
            Remember(name,id);
        }
        foreach(var node in nodes) {
            string id=Text(node,"id"), desired=NativeId("N",id), actual="";
            Check(Model.PointObj.AddCartesian(Value(node,"xMm"),Value(node,"yMm"),Value(node,"zMm"),ref actual,desired,"Global",true),"PointObj.AddCartesian:"+id);
            if(actual!=desired) throw new BridgeError("NATIVE_ID_MISMATCH","ETABS renamed node "+id);
            bool[] restraints=node.GetProperty("restraints").EnumerateArray().Select(x=>x.GetBoolean()).ToArray();
            if(restraints.Length!=6) throw new BridgeError("INVALID_PROJECT","Six restraint DOFs required.");
            Check(Model.PointObj.SetRestraint(actual,ref restraints),"PointObj.SetRestraint:"+id); Remember(actual,id);
        }
        foreach(var f in columns.Concat(beams)) {
            string id=Text(f,"id"), name=NativeId("F",id), section=NativeId("S",id), actual="";
            var s=f.GetProperty("section");
            Check(Model.PropFrame.SetRectangle(section,NativeId("M",Text(f,"materialId")),Value(s,"depthMm"),Value(s,"widthMm")),"PropFrame.SetRectangle:"+id);
            Check(Model.FrameObj.AddByPoint(NativeId("N",Text(f,"startNodeId")),NativeId("N",Text(f,"endNodeId")),ref actual,section,name),"FrameObj.AddByPoint:"+id);
            if(actual!=name) throw new BridgeError("NATIVE_ID_MISMATCH","ETABS renamed frame "+id);
            Check(Model.FrameObj.SetLocalAxes(actual,Value(f,"localAxisAngleDeg")),"FrameObj.SetLocalAxes:"+id); Remember(actual,id);
            Info("RH_KIND_"+actual,Text(f,"kind"));
        }
        foreach(var s in slabs) {
            string id=Text(s,"id"), name=NativeId("A",id), section=NativeId("P",id), actual="";
            var shell=Text(s,"formulation") switch { "SHELL_THIN"=>eShellType.ShellThin,"SHELL_THICK"=>eShellType.ShellThick,"MEMBRANE"=>eShellType.Membrane,
                _=>throw new BridgeError("UNSUPPORTED_SLAB","Unknown shell formulation") };
            Check(Model.PropArea.SetSlab(section,eSlabType.Slab,shell,NativeId("M",Text(s,"materialId")),Value(s,"thicknessMm")),"PropArea.SetSlab:"+id);
            string[] points=s.GetProperty("boundaryNodeIds").EnumerateArray().Select(x=>NativeId("N",x.GetString()!)).ToArray();
            Check(Model.AreaObj.AddByPoint(points.Length,ref points,ref actual,section,name),"AreaObj.AddByPoint:"+id);
            if(actual!=name) throw new BridgeError("NATIVE_ID_MISMATCH","ETABS renamed slab "+id);
            Remember(actual,id);
        }
        var loads=Items(p,"loadCases",64);
        if(loads.Length>0) {
            Check(Model.LoadPatterns.Delete("RH_MODEL_ONLY"),"LoadPatterns.Delete:RH_MODEL_ONLY");
            foreach(var c in loads) {
                string name=NativeId("LC",Text(c,"id"));
                var type=Text(c,"patternType") switch {"DEAD"=>eLoadPatternType.Dead,"LIVE"=>eLoadPatternType.Live,
                    "WIND"=>eLoadPatternType.Wind,"QUAKE"=>eLoadPatternType.Quake,"OTHER"=>eLoadPatternType.Other,
                    _=>throw new BridgeError("INVALID_LOAD","Unsupported pattern type")};
                Check(Model.LoadPatterns.Add(name,type,Value(c,"selfWeightMultiplier"),true),"LoadPatterns.Add:"+name);
                foreach(var load in Items(c,"nodalLoads",500)) {
                    double[] force=load.GetProperty("forceN").EnumerateArray().Concat(load.GetProperty("momentNmm").EnumerateArray()).Select(x=>x.GetDouble()).ToArray();
                    if(force.Length!=6||force.Any(x=>!double.IsFinite(x)))throw new BridgeError("INVALID_LOAD","Six finite load components required");
                    Check(Model.PointObj.SetLoadForce(NativeId("N",Text(load,"nodeId")),name,ref force,true,"Global"),"PointObj.SetLoadForce:"+name);
                }
            }
            foreach(var combo in Items(p,"loadCombinations",64)) {
                string name=NativeId("CO",Text(combo,"id"));
                Check(Model.RespCombo.Add(name,0),"RespCombo.Add:"+name);
                foreach(var term in Items(combo,"terms",64)) {
                    eCNameType type=eCNameType.LoadCase;
                    Check(Model.RespCombo.SetCaseList(name,ref type,NativeId("LC",Text(term,"loadCaseId")),Value(term,"factor")),"RespCombo.SetCaseList:"+name);
                }
            }
        }
        return new { sourceArchitecturalRevisionId=revision };
    }

    static object InspectStructural()
    {
        Check(Model.SetPresentUnits(eUnits.N_mm_C),"SetPresentUnits");
        int n=0; string[] keys=[], values=[];
        Check(Model.GetProjectInfo(ref n,ref keys,ref values),"GetProjectInfo");
        var grids=new List<object>();int gridCount=0;string[] gridNames=[];
        Check(Model.GridSys.GetNameList(ref gridCount,ref gridNames),"GridSys.GetNameList");
        foreach(var name in gridNames) {
            double x=0,y=0,rotation=0;string type="";int nx=0,ny=0;string[] xIds=[],yIds=[],bx=[],by=[];double[] xs=[],ys=[];bool[] vx=[],vy=[];
            Check(Model.GridSys.GetGridSys_2(name,ref x,ref y,ref rotation,ref type,ref nx,ref ny,ref xIds,ref yIds,ref xs,ref ys,ref vx,ref vy,ref bx,ref by),"GridSys.GetGridSys_2:"+name);
            grids.Add(new {name,originXMm=x,originYMm=y,rotationDeg=rotation,type,xIds,yIds,xMm=xs,yMm=ys});
        }
        var info=new Dictionary<string,string>();
        for(int i=0;i<n;i++) info.Add(keys[i],values[i]);
        double baseZ=0; string[] names=[], similar=[]; double[] elevations=[], heights=[], spliceHeight=[];
        bool[] masters=[], splices=[]; int[] colors=[];
        Check(Model.Story.GetStories_2(ref baseZ,ref n,ref names,ref elevations,ref heights,ref masters,ref similar,ref splices,ref spliceHeight,ref colors),"Story.GetStories_2");
        var storeys=Enumerable.Range(0,names.Length).Select(i=>new {name=names[i],elevationMm=elevations[i],heightMm=heights[i]}).ToArray();
        var nodes=new List<object>(); n=0; names=[];
        Check(Model.PointObj.GetNameList(ref n,ref names),"PointObj.GetNameList");
        foreach(var name in names) {
            double x=0,y=0,z=0; bool[] fix=[];
            Check(Model.PointObj.GetCoordCartesian(name,ref x,ref y,ref z),"PointObj.GetCoordCartesian:"+name);
            Check(Model.PointObj.GetRestraint(name,ref fix),"PointObj.GetRestraint:"+name);
            nodes.Add(new {name,xMm=x,yMm=y,zMm=z,restraints=fix});
        }
        var frames=new List<object>(); n=0; names=[];
        Check(Model.FrameObj.GetNameList(ref n,ref names),"FrameObj.GetNameList");
        foreach(var name in names) {
            string a="",b="",section="",auto="",file="",mat="",notes="",guid=""; double angle=0,depth=0,width=0; bool advanced=false; int color=0;
            Check(Model.FrameObj.GetPoints(name,ref a,ref b),"FrameObj.GetPoints:"+name);
            Check(Model.FrameObj.GetSection(name,ref section,ref auto),"FrameObj.GetSection:"+name);
            Check(Model.FrameObj.GetLocalAxes(name,ref angle,ref advanced),"FrameObj.GetLocalAxes:"+name);
            if(advanced || auto!="") throw new BridgeError("NATIVE_MISMATCH","Unexpected advanced axes/auto section: "+name);
            Check(Model.PropFrame.GetRectangle(section,ref file,ref mat,ref depth,ref width,ref color,ref notes,ref guid),"PropFrame.GetRectangle:"+section);
            frames.Add(new {name,startNode=a,endNode=b,section,angleDeg=angle,material=mat,widthMm=width,depthMm=depth});
        }
        var slabs=new List<object>(); n=0; names=[];
        Check(Model.AreaObj.GetNameList(ref n,ref names),"AreaObj.GetNameList");
        foreach(var name in names) {
            int count=0,color=0; string[] points=[]; string section="",mat="",notes="",guid=""; double thickness=0;
            eSlabType type=0; eShellType shell=0;
            Check(Model.AreaObj.GetPoints(name,ref count,ref points),"AreaObj.GetPoints:"+name);
            Check(Model.AreaObj.GetProperty(name,ref section),"AreaObj.GetProperty:"+name);
            Check(Model.PropArea.GetSlab(section,ref type,ref shell,ref mat,ref thickness,ref color,ref notes,ref guid),"PropArea.GetSlab:"+section);
            if(type!=eSlabType.Slab) throw new BridgeError("NATIVE_MISMATCH","Not a slab: "+name);
            slabs.Add(new {name,nodeNames=points,section,material=mat,thicknessMm=thickness,shellType=shell.ToString()});
        }
        var materials=new List<object>(); n=0; names=[];
        Check(Model.PropMaterial.GetNameList(ref n,ref names),"PropMaterial.GetNameList");
        foreach(var name in names.Where(x=>x.StartsWith("RH_M_",StringComparison.Ordinal))) {
            double e=0,nu=0,alpha=0,g=0,weight=0,mass=0; int color=0; string notes="",guid=""; eMatType type=0;
            Check(Model.PropMaterial.GetMaterial(name,ref type,ref color,ref notes,ref guid),"PropMaterial.GetMaterial:"+name);
            Check(Model.PropMaterial.GetMPIsotropic(name,ref e,ref nu,ref alpha,ref g),"PropMaterial.GetMPIsotropic:"+name);
            Check(Model.PropMaterial.GetWeightAndMass(name,ref weight,ref mass),"PropMaterial.GetWeightAndMass:"+name);
            object? concrete=null,reinforcement=null;
            if(type==eMatType.Concrete){
                double fc=0,factor=0,strain=0,ultimate=0,slope=0,friction=0,dilation=0;bool light=false;int ss=0,hys=0;
                Check(Model.PropMaterial.GetOConcrete_1(name,ref fc,ref light,ref factor,ref ss,ref hys,ref strain,ref ultimate,ref slope,ref friction,ref dilation),"PropMaterial.GetOConcrete_1:"+name);
                concrete=new {compressiveStrength=fc,lightweight=light,lightweightFactor=factor,stressStrainType=ss,hysteresisType=hys,strainAtStrength=strain,ultimateStrain=ultimate,finalSlope=slope,frictionAngle=friction,dilatationalAngle=dilation};
            }
            if(type==eMatType.Rebar){
                double fy=0,fu=0,efy=0,efu=0,hard=0,ultimate=0,slope=0;int ss=0,hys=0;bool defaults=false;
                Check(Model.PropMaterial.GetORebar_1(name,ref fy,ref fu,ref efy,ref efu,ref ss,ref hys,ref hard,ref ultimate,ref slope,ref defaults),"PropMaterial.GetORebar_1:"+name);
                if(defaults)throw new BridgeError("MATERIAL_MISMATCH","Unexpected Caltrans defaults");
                reinforcement=new {yieldStrength=fy,ultimateStrength=fu,expectedYieldStrength=efy,expectedUltimateStrength=efu,stressStrainType=ss,hysteresisType=hys,hardeningStrain=hard,ultimateStrain=ultimate,finalSlope=slope};
            }
            materials.Add(new {name,designType=type.ToString(),elasticModulusNPerMm2=e,poissonRatio=nu,thermalExpansionPerC=alpha,massDensityKgPerM3=mass*1e12,concrete,reinforcement});
        }
        n=0; string[] loadCases=[],loadPatterns=[];
        Check(Model.LoadCases.GetNameList(ref n,ref loadCases),"LoadCases.GetNameList");
        Check(Model.LoadPatterns.GetNameList(ref n,ref loadPatterns),"LoadPatterns.GetNameList");
        var loadPatternSelfWeight=new Dictionary<string,double>();
        foreach(var name in loadPatterns){double w=0;Check(Model.LoadPatterns.GetSelfWTMultiplier(name,ref w),"LoadPatterns.GetSelfWTMultiplier:"+name);loadPatternSelfWeight.Add(name,w);}
        var loadPatternTypes=new Dictionary<string,string>();
        foreach(var name in loadPatterns){eLoadPatternType type=0;Check(Model.LoadPatterns.GetLoadType(name,ref type),"LoadPatterns.GetLoadType:"+name);loadPatternTypes.Add(name,type.ToString());}
        var nodalLoads=new List<object>(); n=0; names=[];
        Check(Model.PointObj.GetNameList(ref n,ref names),"PointObj.GetNameList:loads");
        foreach(var node in names){
            int count=0; string[] points=[],patterns=[],systems=[];int[] steps=[];double[] f1=[],f2=[],f3=[],m1=[],m2=[],m3=[];
            Check(Model.PointObj.GetLoadForce(node,ref count,ref points,ref patterns,ref steps,ref systems,ref f1,ref f2,ref f3,ref m1,ref m2,ref m3),"PointObj.GetLoadForce:"+node);
            for(int i=0;i<count;i++)nodalLoads.Add(new {node=points[i],pattern=patterns[i],coordinateSystem=systems[i],forceN=new[]{f1[i],f2[i],f3[i]},momentNmm=new[]{m1[i],m2[i],m3[i]}});
        }
        var staticCases=new List<object>();
        foreach(var name in loadCases){
            int count=0;string[] types=[],patterns=[];double[] factors=[];
            Check(Model.LoadCases.StaticLinear.GetLoads(name,ref count,ref types,ref patterns,ref factors),"StaticLinear.GetLoads:"+name);
            staticCases.Add(new {name,loadTypes=types,patterns,factors});
        }
        var combinations=new List<object>();n=0;names=[];
        Check(Model.RespCombo.GetNameList(ref n,ref names),"RespCombo.GetNameList");
        foreach(var name in names){
            int count=0,method=0;eCNameType[] types=[];string[] cases=[];double[] factors=[];
            Check(Model.RespCombo.GetTypeCombo(name,ref method),"RespCombo.GetTypeCombo:"+name);
            Check(Model.RespCombo.GetCaseList(name,ref count,ref types,ref cases,ref factors),"RespCombo.GetCaseList:"+name);
            combinations.Add(new {name,method,caseTypes=types.Select(x=>x.ToString()).ToArray(),cases,factors});
        }
        return new {units="N_mm_C",grids,projectInfo=info,baseElevationMm=baseZ,storeys,nodes,frames,slabs,materials,loadCases,loadPatterns,loadPatternSelfWeight,loadPatternTypes,nodalLoads,staticCases,combinations};
    }
}
