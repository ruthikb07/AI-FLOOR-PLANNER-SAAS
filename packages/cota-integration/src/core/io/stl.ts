import type { MeshProps } from '../document/types'
import type { Vec3 } from '../math'

/**
 * STL (ASCII o binario) a una malla con los vértices soldados. Un STL binario empieza con 80 bytes de cabecera
 * (que a veces también dice "solid"), así que se decide por el tamaño exacto: 84 + 50 bytes por triángulo.
 */
export function parseStl(buf: ArrayBuffer): MeshProps {
  const dv = new DataView(buf)
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : -1
  const binary = n >= 0 && 84 + n * 50 === buf.byteLength
  const tris: Vec3[] = []
  if (binary) {
    for (let t = 0; t < n; t++) {
      const o = 84 + t * 50 + 12 // salta la normal
      for (let k = 0; k < 3; k++) tris.push([dv.getFloat32(o + k * 12, true), dv.getFloat32(o + k * 12 + 4, true), dv.getFloat32(o + k * 12 + 8, true)])
    }
  } else {
    const text = new TextDecoder().decode(buf)
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g
    for (let m = re.exec(text); m; m = re.exec(text)) tris.push([Number(m[1]), Number(m[2]), Number(m[3])])
    if (tris.length % 3 !== 0 || tris.some((p) => p.some((x) => !Number.isFinite(x)))) throw new Error('Invalid STL file.')
  }
  if (tris.length === 0) throw new Error('The STL file has no triangles.')
  return weld(tris)
}

/** Une los vértices repetidos (misma posición) de una sopa de triángulos. */
export function weld(tris: Vec3[]): MeshProps {
  const vertices: Vec3[] = []
  const index = new Map<string, number>()
  const faces: number[][] = []
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const f = [tris[i], tris[i + 1], tris[i + 2]].map((p) => {
      const k = p.join(',')
      let id = index.get(k)
      if (id === undefined) {
        id = vertices.length
        vertices.push(p)
        index.set(k, id)
      }
      return id
    })
    if (f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2]) faces.push(f)
  }
  return { vertices, faces }
}

/** Exports one or more meshes as an ASCII STL solid string. */
export function exportStl(meshes: ReadonlyArray<MeshProps & { name?: string }>, solidName = 'rh_planner_cad'): string {
  const lines: string[] = [`solid ${solidName.replace(/\s+/g, '_')}`]
  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      if (face.length < 3) continue
      const a = mesh.vertices[face[0]!]
      const b = mesh.vertices[face[1]!]
      const c = mesh.vertices[face[2]!]
      if (!a || !b || !c) continue
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len; ny /= len; nz /= len
      lines.push(`  facet normal ${nx.toExponential(6)} ${ny.toExponential(6)} ${nz.toExponential(6)}`)
      lines.push('    outer loop')
      lines.push(`      vertex ${a[0].toExponential(6)} ${a[1].toExponential(6)} ${a[2].toExponential(6)}`)
      lines.push(`      vertex ${b[0].toExponential(6)} ${b[1].toExponential(6)} ${b[2].toExponential(6)}`)
      lines.push(`      vertex ${c[0].toExponential(6)} ${c[1].toExponential(6)} ${c[2].toExponential(6)}`)
      lines.push('    endloop')
      lines.push('  endfacet')
    }
  }
  lines.push(`endsolid ${solidName.replace(/\s+/g, '_')}`)
  return lines.join('\n') + '\n'
}
