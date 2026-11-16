using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using ETABSv1;

namespace RHPlanner.EtabsBridge;

sealed class BridgeError : Exception
{
    public string Code { get; }
    public int? ApiCode { get; }
    public BridgeError(string code, string message, int? apiCode = null) : base(message) { Code = code; ApiCode = apiCode; }
}

/** One STA thread, owned local ETABS instance, bounded JSON-lines; no sockets or arbitrary API dispatch. */
public static partial class Program
{
    static cOAPI? app;
    static cSapModel Model => app?.SapModel ?? throw new BridgeError("NOT_CONNECTED", "Connect first.");
    static string install = "", root = "", revision = "", version = "", modelPath = "";
    static bool dirty, hasModel, uncertain;
    static string job = "IDLE";
    static string Connection => uncertain ? "FAULTED" : app == null ? "DISCONNECTED" : "CONNECTED";
    static readonly List<object> apiCalls = new();
    static void Check(int code, string api) { apiCalls.Add(new { api, code }); if (code != 0) throw new BridgeError("OAPI_ERROR", api + " returned " + code, code); }
    static string Text(JsonElement r, string key)
    {
        if (!r.TryGetProperty(key, out var p) || p.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(p.GetString()) || p.GetString()!.Length > 256)
            throw new BridgeError("INVALID_REQUEST", "Missing/invalid " + key);
        return p.GetString()!;
    }
    static string[] Names(JsonElement r, string key)
    {
        if (!r.TryGetProperty(key, out var p) || p.ValueKind != JsonValueKind.Array || p.GetArrayLength() > 500)
            throw new BridgeError("INVALID_REQUEST", "Invalid " + key);
        return p.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(x.GetString()) &&
            x.GetString()!.Length <= 256 ? x.GetString()! : throw new BridgeError("INVALID_REQUEST", "Invalid name")).Distinct().ToArray();
    }
    static void NoLinks(string path)
    {
        for (var p = new DirectoryInfo(path); p != null; p = p.Parent)
            if (p.Exists && (p.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new BridgeError("UNSAFE_PATH", "Reparse-point model directories are not allowed.");
    }
    static string FilePath(JsonElement r)
    {
        var name = Text(r, "fileName");
        if (name != Path.GetFileName(name) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
            !name.EndsWith(".edb", StringComparison.OrdinalIgnoreCase) || name.TrimEnd() != name)
            throw new BridgeError("UNSAFE_PATH", "Use an .edb basename in the configured model directory.");
        NoLinks(root);
        var path = Path.Combine(root, name);
        if (File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new BridgeError("UNSAFE_PATH", "Linked model files are not allowed.");
        return path;
    }
    static void RequireModel()
    {
        _ = Model;
        if (!hasModel) throw new BridgeError("NO_MODEL", "Create or open a model first.");
        if (uncertain) throw new BridgeError("SESSION_UNCERTAIN", "Reconnect after a failed model operation.");
    }
    static void ReplaceGuard()
    {
        _ = Model;
        if (dirty) throw new BridgeError("UNSAVED_MODEL", "Save or explicitly disconnect with discardUnsaved before replacing this model.");
    }
    static void NewModel(string sourceRevision, JsonElement? grid = null, double firstHeight = 0, int storeys = 0)
    {
        ReplaceGuard();
        dirty = true; hasModel = false; revision = sourceRevision; modelPath = "";
        Check(Model.InitializeNewModel(eUnits.N_mm_C), "InitializeNewModel");
        if(grid.HasValue) {
            var g=grid.Value;
            // ETABS 23 grid templates use metre input. Set that boundary explicitly and restore canonical units.
            Check(Model.SetPresentUnits(eUnits.kN_m_C),"SetPresentUnits:grid-template-metres");
            Check(Model.File.NewGridOnly(storeys,firstHeight/1000,firstHeight/1000,g.GetProperty("xLineCount").GetInt32(),g.GetProperty("yLineCount").GetInt32(),Value(g,"spacingXMm")/1000,Value(g,"spacingYMm")/1000),"File.NewGridOnly");
            Check(Model.SetPresentUnits(eUnits.N_mm_C),"SetPresentUnits:grid-canonical-mm");
        } else Check(Model.File.NewBlank(), "File.NewBlank");
        hasModel = true; job = "IDLE";
    }
    static object[] CaseStatus()
    {
        int n = 0; string[] names = Array.Empty<string>(); int[] states = Array.Empty<int>();
        Check(Model.Analyze.GetCaseStatus(ref n, ref names, ref states), "Analyze.GetCaseStatus");
        return Enumerable.Range(0, n).Select(i => (object)new { name = names[i], code = states[i],
            state = states[i] switch { 1 => "NOT_RUN", 2 => "COULD_NOT_START", 3 => "NOT_FINISHED", 4 => "FINISHED", _ => "UNKNOWN" } }).ToArray();
    }
    static void Finished(string[] requested)
    {
        int n = 0; string[] names = Array.Empty<string>(); int[] states = Array.Empty<int>();
        Check(Model.Analyze.GetCaseStatus(ref n, ref names, ref states), "Analyze.GetCaseStatus");
        foreach (var name in requested) {
            var i = Array.IndexOf(names, name);
            if (i < 0 || i >= n || states[i] != 4) throw new BridgeError("ANALYSIS_INCOMPLETE", "Case is not finished: " + name);
        }
    }
    static object Fixture(string sourceRevision)
    {
        NewModel(sourceRevision);
        // Synthetic portal frame, not a project-specific material/section/design recommendation.
        Check(Model.PropMaterial.SetMaterial("API_TEST_STEEL", eMatType.Steel), "PropMaterial.SetMaterial");
        Check(Model.PropMaterial.SetMPIsotropic("API_TEST_STEEL", 200000, 0.3, 0.000012), "PropMaterial.SetMPIsotropic");
        Check(Model.PropMaterial.SetWeightAndMass("API_TEST_STEEL", 1, 0.000077), "PropMaterial.SetWeightAndMass");
        Check(Model.PropFrame.SetRectangle("API_TEST_RECT", "API_TEST_STEEL", 300, 300), "PropFrame.SetRectangle");
        var points = new string[4];
        for (int i = 0; i < 4; i++) {
            points[i] = "";
            Check(Model.PointObj.AddCartesian(i % 2 * 4000, 0, i / 2 * 3000, ref points[i], "API_P" + i), "PointObj.AddCartesian");
        }
        for (int i = 0; i < 2; i++) {
            bool[] fix = { true, true, true, true, true, true };
            Check(Model.PointObj.SetRestraint(points[i], ref fix), "PointObj.SetRestraint");
        }
        var frames = new string[3];
        var starts = new[] { 0, 1, 2 }; var ends = new[] { 2, 3, 3 };
        for (int i = 0; i < 3; i++) {
            frames[i] = "";
            Check(Model.FrameObj.AddByPoint(points[starts[i]], points[ends[i]], ref frames[i], "API_TEST_RECT", "API_F" + i), "FrameObj.AddByPoint");
        }
        Check(Model.LoadPatterns.Add("API_TEST", eLoadPatternType.Other, 0, true), "LoadPatterns.Add");
        foreach (var p in points.Skip(2)) {
            double[] force = { 1000, 0, -10000, 0, 0, 0 };
            Check(Model.PointObj.SetLoadForce(p, "API_TEST", ref force), "PointObj.SetLoadForce");
        }
        return new { sourceArchitecturalRevisionId = revision, fixture = new { frameNames = frames,
            nodeNames = points.Take(2).ToArray(), caseName = "API_TEST", expectedReactionN = new[] { -2000, 0, 20000 } } };
    }
    static object Results(JsonElement request)
    {
        RequireModel();
        string caseName = Text(request, "caseName");
        bool combination=request.TryGetProperty("selectionType",out var selection)&&selection.GetString()=="COMBINATION";
        if(combination){
            int count=0;eCNameType[] types=[];string[] cases=[];double[] factors=[];
            Check(Model.RespCombo.GetCaseList(caseName,ref count,ref types,ref cases,ref factors),"RespCombo.GetCaseList:results");
            if(count==0||types.Any(x=>x!=eCNameType.LoadCase))throw new BridgeError("UNSUPPORTED_COMBINATION","Only direct case combinations supported");
            Finished(cases);
        }else Finished(new[] { caseName });
        Check(Model.SetPresentUnits(eUnits.N_mm_C), "SetPresentUnits");
        Check(Model.Results.Setup.DeselectAllCasesAndCombosForOutput(), "Results.Setup.Deselect");
        Check(combination?Model.Results.Setup.SetComboSelectedForOutput(caseName):Model.Results.Setup.SetCaseSelectedForOutput(caseName), "Results.Setup.Select");
        var forces = new List<object>(); var reactions = new List<object>();
        foreach (var frame in Names(request, "frameNames")) {
            int n = 0; string[] obj = [], elm = [], lc = [], st = [];
            double[] os = [], es = [], sn = [], p = [], v2 = [], v3 = [], t = [], m2 = [], m3 = [];
            Check(Model.Results.FrameForce(frame, eItemTypeElm.ObjectElm, ref n, ref obj, ref os, ref elm, ref es,
                ref lc, ref st, ref sn, ref p, ref v2, ref v3, ref t, ref m2, ref m3), "Results.FrameForce");
            if (n == 0) throw new BridgeError("NO_RESULTS", "No frame forces for " + frame);
            for (int i = 0; i < n; i++) forces.Add(new { @object = obj[i], element = elm[i], caseName = lc[i], stepType = st[i], step = sn[i],
                objectStationMm = os[i], elementStationMm = es[i], axialN = p[i], shear2N = v2[i], shear3N = v3[i],
                torsionNmm = t[i], moment2Nmm = m2[i], moment3Nmm = m3[i] });
        }
        foreach (var node in Names(request, "nodeNames")) {
            int n = 0; string[] obj = [], elm = [], lc = [], st = [];
            double[] sn = [], f1 = [], f2 = [], f3 = [], m1 = [], m2 = [], m3 = [];
            Check(Model.Results.JointReact(node, eItemTypeElm.ObjectElm, ref n, ref obj, ref elm, ref lc, ref st, ref sn,
                ref f1, ref f2, ref f3, ref m1, ref m2, ref m3), "Results.JointReact");
            if (n == 0) throw new BridgeError("NO_RESULTS", "No support reactions for " + node);
            for (int i = 0; i < n; i++) reactions.Add(new { @object = obj[i], element = elm[i], caseName = lc[i],
                stepType = st[i], step = sn[i], forceN = new[] { f1[i], f2[i], f3[i] }, momentNmm = new[] { m1[i], m2[i], m3[i] } });
        }
        var displacements=new List<object>();
        if(request.TryGetProperty("displacementNodeNames",out _))foreach(var node in Names(request,"displacementNodeNames")) {
            int n=0;string[] obj=[],elm=[],lc=[],st=[];double[] sn=[],u1=[],u2=[],u3=[],r1=[],r2=[],r3=[];
            Check(Model.Results.JointDispl(node,eItemTypeElm.ObjectElm,ref n,ref obj,ref elm,ref lc,ref st,ref sn,ref u1,ref u2,ref u3,ref r1,ref r2,ref r3),"Results.JointDispl:"+node);
            if(n==0)throw new BridgeError("NO_RESULTS","No displacements for "+node);
            for(int i=0;i<n;i++)displacements.Add(new {@object=obj[i],element=elm[i],caseName=lc[i],stepType=st[i],step=sn[i],translationMm=new[]{u1[i],u2[i],u3[i]},rotationRad=new[]{r1[i],r2[i],r3[i]}});
        }
        return new { result = new { sourceArchitecturalRevisionId = revision, applicationVersion = version, modelFile = modelPath,
            units = "N_mm_C", verification = "NATIVE_API", engineeringApproval = "NOT_PROVIDED",
            cases = CaseStatus(), frameForces = forces, supportReactions = reactions, jointDisplacements=displacements } };
    }
    static object Dispatch(JsonElement r, string op)
    {
        switch (op) {
            case "importStructural": return ImportStructural(r.GetProperty("project"));
            case "inspectStructural": RequireModel(); return new { snapshot = InspectStructural() };
            case "detect":
                var exe = Path.Combine(install, "ETABS.exe");
                if (!File.Exists(exe) || !File.Exists(Path.Combine(install, "ETABSv1.dll")))
                    throw new BridgeError("ETABS_NOT_FOUND", "ETABS executable/API library not found.");
                return new { executable = exe, apiLibrary = Path.Combine(install, "ETABSv1.dll"),
                    installedVersion = System.Diagnostics.FileVersionInfo.GetVersionInfo(exe).FileVersion, licenseStatus = "UNVERIFIED" };
            case "connect":
                if (app != null) throw new BridgeError("ALREADY_CONNECTED", "This bridge already owns an instance.");
                cHelper helper = new Helper();
                app = helper.CreateObject(Path.Combine(install, "ETABS.exe")) ?? throw new BridgeError("CONNECT_FAILED", "Helper returned no application.");
                Check(app.ApplicationStart(), "ApplicationStart");
                Check(app.Hide(), "Hide");
                uncertain = false;
                goto case "version";
            case "version":
                double number = 0; string v = "";
                Check(Model.GetVersion(ref v, ref number), "GetVersion"); version = v;
                return new { applicationVersion = version, apiVersion = app!.GetOAPIVersionNumber() };
            case "create": NewModel(Text(r, "sourceArchitecturalRevisionId")); return new { sourceArchitecturalRevisionId = revision };
            case "fixture": return Fixture(Text(r, "sourceArchitecturalRevisionId"));
            case "open":
                ReplaceGuard();
                var open = FilePath(r); var source = Text(r, "sourceArchitecturalRevisionId");
                if (!File.Exists(open)) throw new BridgeError("MODEL_NOT_FOUND", "Model does not exist.");
                // Errors may leave partial native state: the catch marks this session uncertain.
                Check(Model.File.OpenFile(open), "File.OpenFile");
                Check(Model.SetPresentUnits(eUnits.N_mm_C), "SetPresentUnits");
                hasModel = true; dirty = false; modelPath = open; revision = source; job = "IDLE";
                return new { fileName = Path.GetFileName(open), sourceArchitecturalRevisionId = revision };
            case "save":
                RequireModel(); var save = FilePath(r);
                if (File.Exists(save) && !save.Equals(modelPath, StringComparison.OrdinalIgnoreCase))
                    throw new BridgeError("FILE_EXISTS", "Refusing to overwrite a different existing model.");
                Check(Model.File.Save(save), "File.Save");
                if (!File.Exists(save) || new FileInfo(save).Length == 0) throw new BridgeError("ARTIFACT_MISSING", "Save returned without nonempty EDB bytes.");
                modelPath = save; dirty = false;
                return new { fileName = Path.GetFileName(save) };
            case "analyze":
                RequireModel(); var cases = Names(r, "caseNames");
                if (cases.Length == 0) throw new BridgeError("INVALID_REQUEST", "Select at least one load case.");
                if (dirty || modelPath == "") throw new BridgeError("SAVE_REQUIRED", "Save the model before analysis.");
                job = "RUNNING";
                Check(Model.Analyze.SetRunCaseFlag("", false, true), "Analyze.DisableCases");
                foreach (var c in cases) Check(Model.Analyze.SetRunCaseFlag(c, true), "Analyze.EnableCase");
                Check(Model.Analyze.RunAnalysis(), "Analyze.RunAnalysis"); Finished(cases);
                job = "SUCCEEDED"; return new { cases = CaseStatus() };
            case "status": RequireModel(); return new { cases = CaseStatus() };
            case "results": return Results(r);
            case "disconnect":
                bool discard = r.TryGetProperty("discardUnsaved", out var d) && d.ValueKind == JsonValueKind.True;
                if ((dirty || uncertain) && !discard) throw new BridgeError("UNSAVED_MODEL", "Save first or explicitly discard the owned model.");
                if (app != null) Check(app.ApplicationExit(false), "ApplicationExit");
                app = null; hasModel = dirty = uncertain = false; modelPath = revision = version = ""; job = "IDLE";
                return new { };
            default: throw new BridgeError("INVALID_OPERATION", "Unsupported operation.");
        }
    }
    [STAThread]
    public static void Main(string[] args)
    {
        if (args.Length != 2) { Console.Error.WriteLine("Usage: bridge <ETABS install directory> <model directory>"); return; }
        install = Path.GetFullPath(args[0]); root = Path.GetFullPath(args[1]);
        NoLinks(root); Directory.CreateDirectory(root); NoLinks(root);
        // EOF deliberately does NOT close ETABS: a lost client must not discard an unsaved native model.
        string? line;
        while ((line = ReadBoundedLine()) != null) {
            apiCalls.Clear();
            string id = "", op = "";
            try {
                using var doc = JsonDocument.Parse(line);
                var r = doc.RootElement; id = Text(r, "id"); op = Text(r, "operation");
                if (!r.TryGetProperty("protocolVersion", out var pv) || !pv.TryGetInt32(out var protocol) || protocol != 1)
                    throw new BridgeError("PROTOCOL_MISMATCH", "Expected protocolVersion 1.");
                if (uncertain && op != "disconnect" && op != "detect") throw new BridgeError("SESSION_UNCERTAIN", "Disconnect explicitly before continuing.");
                object data = Dispatch(r, op);
                Console.WriteLine(JsonSerializer.Serialize(new { id, protocolVersion = 1, ok = true, connection = Connection, job, data, apiCalls }));
            } catch (Exception ex) {
                var e = ex as BridgeError;
                if (op == "analyze") job = "FAILED";
                if (app != null && (e == null || e.Code == "OAPI_ERROR") && new[] { "connect", "create", "open", "fixture", "importStructural" }.Contains(op)) uncertain = true;
                Console.WriteLine(JsonSerializer.Serialize(new { id, protocolVersion = 1, ok = false, connection = Connection, job,
                    error = new { code = e?.Code ?? "BRIDGE_ERROR", message = ex.Message, operation = op, apiReturnCode = e?.ApiCode }, apiCalls }));
            }
        }
    }
    static string? ReadBoundedLine()
    {
        var line = new System.Text.StringBuilder();
        int ch;
        while ((ch = Console.Read()) != -1) {
            if (ch == '\n') return line.ToString();
            if (line.Length >= 1048576) { Console.Error.WriteLine("Request exceeds 1 MiB; transport closed, native session retained."); return null; }
            if (ch != '\r') line.Append((char)ch);
        }
        return line.Length == 0 ? null : line.ToString();
    }
}
