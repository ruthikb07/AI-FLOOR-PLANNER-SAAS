/**
 * BCF 2.1 `.bcfzip` / `.bcf` Archive Writer & Reader (`fflate`-backed, Node + Browser).
 *
 * Adapted from OpenBIMStudio 0.74.0 (`src/modules/issues/bcf-markup.ts` &
 * `src/modules/export/bcf21.ts`, MIT). Includes a lightweight Node+Browser XML
 * DOM shim so BCF 2.1 round-trip works identically in Vitest Node suites and
 * browser sessions without requiring external DOM libraries.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  bcfGuid,
  buildBcfMarkup,
  isBcfGuid,
  parseBcfMarkup,
  setBcfDomParserFactory,
  xmlEscape,
  type BcfDocumentLike,
  type BcfDomParser,
  type BcfElementLike,
  type BcfMarkupTopic,
  type BcfParsedTopic,
} from './bcf-markup';

export interface OpenBimBcfCamera {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
  readonly up: { readonly x: number; readonly y: number; readonly z: number };
  readonly fieldOfView?: number;
}

export interface OpenBimBcfComponent {
  readonly ifcGuid?: string;
  readonly authoringToolId?: string;
  readonly originatingSystem?: string;
}

export interface OpenBimBcfIssue extends BcfMarkupTopic {
  readonly projectId: string;
  readonly canonicalRevision: number;
  readonly camera?: OpenBimBcfCamera;
  readonly components?: readonly OpenBimBcfComponent[];
}

class MiniXmlElement implements BcfElementLike {
  readonly tagName: string;
  readonly attrs: Map<string, string>;
  readonly childNodes: MiniXmlElement[];
  rawText: string;

  constructor(tagName: string, attrs: Map<string, string> = new Map()) {
    this.tagName = tagName;
    this.attrs = attrs;
    this.childNodes = [];
    this.rawText = '';
  }

  get children(): ArrayLike<BcfElementLike> {
    return this.childNodes;
  }

  get textContent(): string {
    if (this.childNodes.length === 0) return this.rawText;
    return this.rawText + this.childNodes.map(c => c.textContent).join('');
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  querySelector(selectors: string): BcfElementLike | null {
    return this.querySelectorAll(selectors)[0] ?? null;
  }

  querySelectorAll(selectors: string): ArrayLike<BcfElementLike> {
    const want = selectors.trim();
    const out: BcfElementLike[] = [];
    const visit = (node: MiniXmlElement) => {
      for (const ch of node.childNodes) {
        if (ch.tagName === want || ch.tagName.endsWith(`:${want}`)) out.push(ch);
        visit(ch);
      }
    };
    visit(this);
    return out;
  }
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseMiniXml(xml: string): BcfDocumentLike {
  const root = new MiniXmlElement('#document');
  const stack: MiniXmlElement[] = [root];
  const cleaned = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const tokenRe = /<(\/?)([A-Za-z0-9_:-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(cleaned)) !== null) {
    if (m[5] !== undefined) {
      const txt = unescapeXml(m[5]);
      if (txt.trim()) stack[stack.length - 1]!.rawText += txt;
      continue;
    }
    const closing = m[1] === '/';
    const selfClosing = m[4] === '/';
    const tag = m[2]!.includes(':') ? m[2]!.split(':').pop()! : m[2]!;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = new Map<string, string>();
    const attrRe = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(m[3] ?? '')) !== null) {
      attrs.set(am[1]!, unescapeXml(am[2] ?? am[3] ?? ''));
    }
    const el = new MiniXmlElement(tag, attrs);
    stack[stack.length - 1]!.childNodes.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

// Ensure Node/Vitest environments always have a working BCF XML parser
if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === 'undefined') {
  setBcfDomParserFactory(() => ({
    parseFromString: (xml: string): BcfDocumentLike => parseMiniXml(xml),
  } satisfies BcfDomParser));
}

function buildViewpointXml(issue: OpenBimBcfIssue): string {
  const cam = issue.camera ?? {
    position: { x: 15, y: 12, z: 15 },
    direction: { x: -0.577, y: -0.577, z: -0.577 },
    up: { x: 0, y: 1, z: 0 },
    fieldOfView: 55,
  };
  const comps = (issue.components ?? [])
    .map(
      c =>
        `      <Component${c.ifcGuid ? ` IfcGuid="${xmlEscape(c.ifcGuid)}"` : ''}>` +
        `${c.originatingSystem ? `<OriginatingSystem>${xmlEscape(c.originatingSystem)}</OriginatingSystem>` : ''}` +
        `${c.authoringToolId ? `<AuthoringToolId>${xmlEscape(c.authoringToolId)}</AuthoringToolId>` : ''}` +
        `</Component>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${xmlEscape(bcfGuid())}">
  <Components>
    <Selection>
${comps}
    </Selection>
  </Components>
  <PerspectiveCamera>
    <CameraViewPoint><X>${cam.position.x.toFixed(4)}</X><Y>${cam.position.y.toFixed(4)}</Y><Z>${cam.position.z.toFixed(4)}</Z></CameraViewPoint>
    <CameraDirection><X>${cam.direction.x.toFixed(4)}</X><Y>${cam.direction.y.toFixed(4)}</Y><Z>${cam.direction.z.toFixed(4)}</Z></CameraDirection>
    <CameraUpVector><X>${cam.up.x.toFixed(4)}</X><Y>${cam.up.y.toFixed(4)}</Y><Z>${cam.up.z.toFixed(4)}</Z></CameraUpVector>
    <FieldOfView>${(cam.fieldOfView ?? 55).toFixed(1)}</FieldOfView>
  </PerspectiveCamera>
</VisualizationInfo>
`;
}

export function exportBcf21Archive(params: {
  readonly projectId: string;
  readonly projectName: string;
  readonly issues: readonly OpenBimBcfIssue[];
}): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files['bcf.version'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Version VersionId="2.1" DetailedVersion="2.1"/>\n`,
  );
  files['project.bcfp'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<ProjectExtension>\n  <Project ProjectId="${xmlEscape(params.projectId)}">\n    <Name>${xmlEscape(params.projectName)}</Name>\n  </Project>\n</ProjectExtension>\n`,
  );

  for (const issue of params.issues) {
    const guid = isBcfGuid(issue.guid) ? issue.guid : bcfGuid();
    const vpFile = 'viewpoint.bcfv';
    const markup = buildBcfMarkup({
      ...issue,
      guid,
      viewpointFile: vpFile,
    });
    files[`${guid}/markup.bcf`] = strToU8(markup);
    files[`${guid}/${vpFile}`] = strToU8(buildViewpointXml({ ...issue, guid }));
  }

  return zipSync(files, { level: 6 });
}

export function importBcf21Archive(
  bytes: Uint8Array,
  projectId: string,
  canonicalRevision: number,
): OpenBimBcfIssue[] {
  const entries = unzipSync(bytes);
  const issues: OpenBimBcfIssue[] = [];
  for (const [entryPath, data] of Object.entries(entries)) {
    if (!entryPath.toLowerCase().endsWith('/markup.bcf') && entryPath.toLowerCase() !== 'markup.bcf') {
      continue;
    }
    const xml = strFromU8(data);
    const parsed: BcfParsedTopic | null = parseBcfMarkup(xml);
    if (!parsed) continue;
    issues.push({
      guid: parsed.guid,
      projectId,
      canonicalRevision,
      topicType: parsed.topicType,
      topicStatus: parsed.topicStatus,
      title: parsed.title,
      priority: parsed.priority,
      labels: parsed.labels,
      createdAt: parsed.createdAt,
      createdBy: parsed.author || 'BIM Coordinator',
      modifiedAt: parsed.updatedAt,
      dueDate: parsed.dueDate,
      assignedTo: parsed.assignee,
      description: parsed.description,
      comments: parsed.comments,
    });
  }
  return issues;
}

export { bcfGuid, isBcfGuid, buildBcfMarkup, parseBcfMarkup, type BcfMarkupTopic, type BcfParsedTopic };
