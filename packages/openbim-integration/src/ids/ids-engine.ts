/**
 * buildingSMART IDS 1.0 (Information Delivery Specification) Engine.
 *
 * Adapted from OpenBIMStudio 0.74.0 (`src/features/ids.ts`, MIT) to run
 * deterministically in both Node and Browser without DOM globals, auditing
 * entity, attribute, property, classification, material, and partOf facets.
 */

export type IdsSeverity = 'pass' | 'fail' | 'warning' | 'unsupported';

export interface IdsRestriction {
  readonly kind:
    | 'simpleValue'
    | 'enumeration'
    | 'pattern'
    | 'minInclusive'
    | 'maxInclusive'
    | 'minExclusive'
    | 'maxExclusive'
    | 'length'
    | 'minLength'
    | 'maxLength';
  readonly values: readonly string[];
}

export interface IdsFacet {
  readonly type: 'entity' | 'attribute' | 'property' | 'classification' | 'material' | 'partOf';
  readonly name?: string;
  readonly propertySet?: string;
  readonly system?: string;
  readonly value?: string;
  readonly relation?: string;
  readonly restriction?: IdsRestriction;
  readonly cardinality: 'required' | 'optional' | 'prohibited';
}

export interface IdsSpecification {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly ifcVersion: string;
  readonly applicability: readonly IdsFacet[];
  readonly requirements: readonly IdsFacet[];
}

export interface IdsDocument {
  readonly title?: string;
  readonly version?: string;
  readonly author?: string;
  readonly date?: string;
  readonly specifications: readonly IdsSpecification[];
}

export interface IdsInspectableElement {
  readonly canonicalId: string;
  readonly globalId: string;
  readonly ifcClass: string;
  readonly name: string;
  readonly floorId: string;
  readonly floorName: string;
  readonly material?: string;
  readonly classificationSystem?: string;
  readonly classificationCode?: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly propertySets: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;
}

export interface IdsCheckResult {
  readonly specificationId: string;
  readonly specificationName: string;
  readonly elementId: string;
  readonly globalId: string;
  readonly elementName: string;
  readonly ifcClass: string;
  readonly facet: string;
  readonly severity: IdsSeverity;
  readonly message: string;
  readonly actual?: string;
}

export interface IdsAuditReport {
  readonly document: IdsDocument;
  readonly results: readonly IdsCheckResult[];
  readonly elementsChecked: number;
  readonly passRatePct: number;
  readonly failedSpecifications: number;
  readonly summary: ReadonlyArray<{
    readonly specificationId: string;
    readonly specificationName: string;
    readonly applicableCount: number;
    readonly passed: number;
    readonly failed: number;
    readonly unsupported: number;
  }>;
}

interface XmlNode {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: XmlNode[];
  text: string;
}

function parseXmlTree(xml: string): XmlNode {
  const root: XmlNode = { name: '#doc', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const cleaned = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([A-Za-z0-9_:-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[5] !== undefined) {
      const t = m[5].trim();
      if (t) stack[stack.length - 1]!.text += t;
      continue;
    }
    const closing = m[1] === '/';
    const selfClose = m[4] === '/';
    const localName = m[2]!.includes(':') ? m[2]!.split(':').pop()! : m[2]!;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrRe = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(m[3] ?? '')) !== null) {
      const k = am[1]!.includes(':') ? am[1]!.split(':').pop()! : am[1]!;
      attrs[k] = am[2] ?? am[3] ?? '';
    }
    const node: XmlNode = { name: localName, attrs, children: [], text: '' };
    stack[stack.length - 1]!.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

const child = (n: XmlNode | undefined, name: string) => n?.children.find(c => c.name === name);
const children = (n: XmlNode | undefined, name: string) => (n?.children ?? []).filter(c => c.name === name);

function readValueConstraint(holder: XmlNode | undefined): { simple?: string; restriction?: IdsRestriction } {
  if (!holder) return {};
  const sv = child(holder, 'simpleValue');
  if (sv) return { simple: sv.text.trim(), restriction: { kind: 'simpleValue', values: [sv.text.trim()] } };
  const restr = child(holder, 'restriction');
  if (!restr) return {};
  const enums = children(restr, 'enumeration').map(e => e.attrs.value ?? '').filter(Boolean);
  if (enums.length > 0) return { restriction: { kind: 'enumeration', values: enums } };
  for (const c of restr.children) {
    if (
      ['pattern', 'minInclusive', 'maxInclusive', 'minExclusive', 'maxExclusive', 'length', 'minLength', 'maxLength'].includes(
        c.name,
      ) &&
      c.attrs.value !== undefined
    ) {
      return { restriction: { kind: c.name as IdsRestriction['kind'], values: [c.attrs.value] } };
    }
  }
  return {};
}

function parseFacetNode(el: XmlNode): IdsFacet | null {
  const cardinality = (el.attrs.cardinality as IdsFacet['cardinality'] | undefined) ?? 'required';
  switch (el.name) {
    case 'entity': {
      const nm = readValueConstraint(child(el, 'name'));
      return { type: 'entity', name: nm.simple, restriction: nm.restriction, cardinality };
    }
    case 'attribute': {
      const nm = readValueConstraint(child(el, 'name'));
      const val = readValueConstraint(child(el, 'value'));
      return { type: 'attribute', name: nm.simple, value: val.simple, restriction: val.restriction, cardinality };
    }
    case 'property': {
      const ps = readValueConstraint(child(el, 'propertySet'));
      const nm = readValueConstraint(child(el, 'baseName') ?? child(el, 'name'));
      const val = readValueConstraint(child(el, 'value'));
      return {
        type: 'property',
        propertySet: ps.simple,
        name: nm.simple,
        value: val.simple,
        restriction: val.restriction,
        cardinality,
      };
    }
    case 'classification': {
      const sys = readValueConstraint(child(el, 'system'));
      const val = readValueConstraint(child(el, 'value'));
      return {
        type: 'classification',
        system: sys.simple,
        value: val.simple,
        restriction: val.restriction,
        cardinality,
      };
    }
    case 'material': {
      const val = readValueConstraint(child(el, 'value'));
      return { type: 'material', value: val.simple, restriction: val.restriction, cardinality };
    }
    case 'partOf': {
      const ent = child(el, 'entity');
      const nm = readValueConstraint(child(ent, 'name'));
      return { type: 'partOf', name: nm.simple, relation: el.attrs.relation, cardinality };
    }
    default:
      return null;
  }
}

export function parseIdsXml(xml: string): IdsDocument {
  const doc = parseXmlTree(xml);
  const idsRoot = child(doc, 'ids') ?? doc.children[0];
  if (!idsRoot) throw new Error('Invalid IDS XML: missing <ids> root element.');
  const info = child(idsRoot, 'info');
  const specsNode = child(idsRoot, 'specifications');
  const specs: IdsSpecification[] = children(specsNode, 'specification').map((sp, idx) => {
    const appNode = child(sp, 'applicability');
    const reqNode = child(sp, 'requirements');
    return {
      id: sp.attrs.identifier ?? `spec-${idx + 1}`,
      name: sp.attrs.name ?? `Specification ${idx + 1}`,
      description: sp.attrs.description,
      ifcVersion: sp.attrs.ifcVersion ?? 'IFC4',
      applicability: (appNode?.children ?? []).map(parseFacetNode).filter((f): f is IdsFacet => Boolean(f)),
      requirements: (reqNode?.children ?? []).map(parseFacetNode).filter((f): f is IdsFacet => Boolean(f)),
    };
  });
  return {
    title: child(info, 'title')?.text,
    version: child(info, 'version')?.text,
    author: child(info, 'author')?.text,
    date: child(info, 'date')?.text,
    specifications: specs,
  };
}

function matchesRestriction(actual: string, r: IdsRestriction | undefined): boolean {
  if (!r) return actual.length > 0;
  switch (r.kind) {
    case 'simpleValue':
      return actual.toUpperCase() === (r.values[0] ?? '').toUpperCase();
    case 'enumeration':
      return r.values.some(v => v.toUpperCase() === actual.toUpperCase());
    case 'pattern':
      try {
        return new RegExp(`^(?:${r.values[0] ?? ''})$`).test(actual);
      } catch {
        return false;
      }
    case 'minInclusive':
      return Number(actual) >= Number(r.values[0]);
    case 'maxInclusive':
      return Number(actual) <= Number(r.values[0]);
    case 'minExclusive':
      return Number(actual) > Number(r.values[0]);
    case 'maxExclusive':
      return Number(actual) < Number(r.values[0]);
    case 'length':
      return actual.length === Number(r.values[0]);
    case 'minLength':
      return actual.length >= Number(r.values[0]);
    case 'maxLength':
      return actual.length <= Number(r.values[0]);
  }
}

function evaluateFacet(el: IdsInspectableElement, facet: IdsFacet): { ok: boolean; actual?: string; label: string } {
  switch (facet.type) {
    case 'entity': {
      const actual = el.ifcClass.toUpperCase();
      const ok = facet.restriction ? matchesRestriction(actual, facet.restriction) : actual === (facet.name ?? '').toUpperCase();
      return { ok, actual, label: `Entity ${facet.name ?? '*'}` };
    }
    case 'attribute': {
      const key = facet.name ?? 'Name';
      const actual =
        key === 'GlobalId'
          ? el.globalId
          : key === 'Name'
          ? el.name
          : el.attributes[key];
      if (actual === undefined || actual === '') {
        return { ok: facet.cardinality === 'optional' || facet.cardinality === 'prohibited', actual: undefined, label: `Attribute ${key}` };
      }
      const valOk = facet.restriction ? matchesRestriction(actual, facet.restriction) : true;
      return {
        ok: facet.cardinality === 'prohibited' ? !valOk : valOk,
        actual,
        label: `Attribute ${key}`,
      };
    }
    case 'property': {
      const psetName = facet.propertySet ?? '';
      const propName = facet.name ?? '';
      const pset = el.propertySets[psetName];
      const raw = pset ? pset[propName] : undefined;
      if (raw === undefined) {
        return {
          ok: facet.cardinality === 'optional' || facet.cardinality === 'prohibited',
          actual: undefined,
          label: `${psetName}.${propName}`,
        };
      }
      const actual = String(raw);
      const valOk = facet.restriction ? matchesRestriction(actual, facet.restriction) : true;
      return {
        ok: facet.cardinality === 'prohibited' ? !valOk : valOk,
        actual,
        label: `${psetName}.${propName}`,
      };
    }
    case 'classification': {
      const hasClass = Boolean(el.classificationCode);
      if (!hasClass) {
        return { ok: facet.cardinality === 'optional' || facet.cardinality === 'prohibited', label: 'Classification' };
      }
      const sysOk = !facet.system || (el.classificationSystem ?? '').toUpperCase() === facet.system.toUpperCase();
      const valOk = facet.restriction ? matchesRestriction(el.classificationCode!, facet.restriction) : true;
      return {
        ok: facet.cardinality === 'prohibited' ? !(sysOk && valOk) : sysOk && valOk,
        actual: `${el.classificationSystem ?? 'System'}:${el.classificationCode}`,
        label: `Classification ${facet.system ?? ''}`.trim(),
      };
    }
    case 'material': {
      if (!el.material) {
        return { ok: facet.cardinality === 'optional' || facet.cardinality === 'prohibited', label: 'Material' };
      }
      const valOk = facet.restriction ? matchesRestriction(el.material, facet.restriction) : true;
      return {
        ok: facet.cardinality === 'prohibited' ? !valOk : valOk,
        actual: el.material,
        label: 'Material',
      };
    }
    case 'partOf': {
      const ok = Boolean(el.floorId) && (!facet.name || facet.name.toUpperCase() === 'IFCBUILDINGSTOREY');
      return {
        ok: facet.cardinality === 'prohibited' ? !ok : ok,
        actual: el.floorName,
        label: `PartOf ${facet.name ?? 'IfcBuildingStorey'}`,
      };
    }
  }
}

export function validateElementsAgainstIds(
  idsDoc: IdsDocument,
  elements: readonly IdsInspectableElement[],
): IdsAuditReport {
  const results: IdsCheckResult[] = [];
  const summary: Array<{
    specificationId: string;
    specificationName: string;
    applicableCount: number;
    passed: number;
    failed: number;
    unsupported: number;
  }> = [];

  for (const spec of idsDoc.specifications) {
    let applicableCount = 0;
    let passed = 0;
    let failed = 0;
    const unsupported = 0;

    for (const el of elements) {
      const isApplicable =
        spec.applicability.length > 0 && spec.applicability.every(app => evaluateFacet(el, app).ok);
      if (!isApplicable) continue;
      applicableCount++;

      for (const req of spec.requirements) {
        const check = evaluateFacet(el, req);
        if (check.ok) {
          passed++;
          results.push({
            specificationId: spec.id,
            specificationName: spec.name,
            elementId: el.canonicalId,
            globalId: el.globalId,
            elementName: el.name,
            ifcClass: el.ifcClass,
            facet: check.label,
            severity: 'pass',
            message: `${check.label} satisfied${check.actual !== undefined ? ` (${check.actual})` : ''}.`,
            actual: check.actual,
          });
        } else {
          failed++;
          results.push({
            specificationId: spec.id,
            specificationName: spec.name,
            elementId: el.canonicalId,
            globalId: el.globalId,
            elementName: el.name,
            ifcClass: el.ifcClass,
            facet: check.label,
            severity: 'fail',
            message: `${check.label} failed on ${el.name}${check.actual !== undefined ? ` (actual: ${check.actual})` : ' (missing)'}.`,
            actual: check.actual,
          });
        }
      }
    }

    summary.push({
      specificationId: spec.id,
      specificationName: spec.name,
      applicableCount,
      passed,
      failed,
      unsupported,
    });
  }

  const totalChecks = summary.reduce((s, r) => s + r.passed + r.failed, 0);
  const totalPassed = summary.reduce((s, r) => s + r.passed, 0);
  const passRatePct = totalChecks === 0 ? 100 : Math.round((totalPassed / totalChecks) * 1000) / 10;
  const failedSpecifications = summary.filter(r => r.failed > 0).length;

  return {
    document: idsDoc,
    results,
    elementsChecked: elements.length,
    passRatePct,
    failedSpecifications,
    summary,
  };
}

export const DEFAULT_RESIDENTIAL_IDS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <info>
    <title>RH Planner Residential Architectural BIM Delivery Standard</title>
    <version>1.0</version>
    <author>RH Planner Studio</author>
  </info>
  <specifications>
    <specification identifier="IDS-WALL-01" name="Walls carry Pset_WallCommon &amp; Storey Containment" ifcVersion="IFC4">
      <applicability>
        <entity><name><simpleValue>IFCWALL</simpleValue></name></entity>
      </applicability>
      <requirements>
        <attribute cardinality="required"><name><simpleValue>Name</simpleValue></name></attribute>
        <property cardinality="required">
          <propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet>
          <baseName><simpleValue>IsExternal</simpleValue></baseName>
        </property>
        <material cardinality="required" />
        <partOf cardinality="required"><entity><name><simpleValue>IFCBUILDINGSTOREY</simpleValue></name></entity></partOf>
      </requirements>
    </specification>
    <specification identifier="IDS-OPENING-02" name="Doors &amp; Windows carry Positive Clear Width" ifcVersion="IFC4">
      <applicability>
        <entity>
          <name>
            <restriction base="xs:string">
              <enumeration value="IFCDOOR" />
              <enumeration value="IFCWINDOW" />
            </restriction>
          </name>
        </entity>
      </applicability>
      <requirements>
        <property cardinality="required">
          <propertySet><simpleValue>Pset_OpeningCommon</simpleValue></propertySet>
          <baseName><simpleValue>WidthMm</simpleValue></baseName>
          <value><restriction base="xs:double"><minInclusive value="400" /></restriction></value>
        </property>
      </requirements>
    </specification>
    <specification identifier="IDS-SPACE-03" name="Rooms carry Positive Net Floor Area" ifcVersion="IFC4">
      <applicability>
        <entity><name><simpleValue>IFCSPACE</simpleValue></name></entity>
      </applicability>
      <requirements>
        <property cardinality="required">
          <propertySet><simpleValue>Pset_SpaceCommon</simpleValue></propertySet>
          <baseName><simpleValue>NetPlannedAreaSqm</simpleValue></baseName>
          <value><restriction base="xs:double"><minExclusive value="0.1" /></restriction></value>
        </property>
      </requirements>
    </specification>
  </specifications>
</ids>
`;
