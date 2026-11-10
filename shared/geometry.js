import Module from "../vendor/manifold/manifold.js";
import { FontLoader } from "../vendor/FontLoader.js";
import fontData from "./font-data.js";
import { validate, VERSION, dimensions, holeCenters } from "./schema.js";
const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection } = wasm;
const font = new FontLoader().parse(fontData);
export function generate(family, params) {
  const errors = validate(family, params);
  if (Object.keys(errors).length)
    throw Object.assign(Error("Invalid settings"), { errors });
  const p = params,
    allocated = [];
  const keep = (o) => (allocated.push(o), o);
  const move = (o, v) => keep(keep(o).translate(v));
  try {
    let solid = move(Manifold.cube([p.width, p.depth, p.thickness]), [
      -p.width / 2,
      -p.depth / 2,
      0,
    ]);
    if (family === "plate")
      for (const [x, y] of holeCenters(p)) {
        const hole = move(
          Manifold.cylinder(
            p.thickness + 2,
            p.holeDiameter / 2,
            p.holeDiameter / 2,
            64,
          ),
          [x, y, -1],
        );
        solid = keep(solid.subtract(hole));
      }
    if (family === "tray") {
      solid = move(Manifold.cube([p.width, p.depth, p.height]), [
        -p.width / 2,
        -p.depth / 2,
        0,
      ]);
      const inner = (p.width - (p.columns + 1) * p.wall) / p.columns;
      for (let c = 0; c < p.columns; c++) {
        const cavity = move(
          Manifold.cube([inner, p.depth - 2 * p.wall, p.height]),
          [
            -p.width / 2 + p.wall + c * (inner + p.wall),
            -p.depth / 2 + p.wall,
            p.thickness,
          ],
        );
        solid = keep(solid.subtract(cavity));
      }
    }
    if (family === "sign") {
      const shapes = font.generateShapes(p.text, 10),
        polygons = [];
      for (const shape of shapes) {
        const pts = shape.extractPoints(10);
        polygons.push(
          pts.shape.map((v) => [v.x, v.y]),
          ...pts.holes.map((h) => h.map((v) => [v.x, v.y])),
        );
      }
      const points = polygons.flat();
      const min = [
          Math.min(...points.map((v) => v[0])),
          Math.min(...points.map((v) => v[1])),
        ],
        max = [
          Math.max(...points.map((v) => v[0])),
          Math.max(...points.map((v) => v[1])),
        ];
      const scale = Math.min(
        (p.width - 8) / (max[0] - min[0]),
        (p.depth - 8) / (max[1] - min[1]),
      );
      const centered = polygons.map((poly) =>
        poly.map(([x, y]) => [
          (x - (min[0] + max[0]) / 2) * scale,
          (y - (min[1] + max[1]) / 2) * scale,
        ]),
      );
      const section = keep(new CrossSection(centered, "EvenOdd"));
      const letters = move(section.extrude(p.textHeight + 0.15), [
        0,
        0,
        p.thickness - 0.15,
      ]);
      solid = keep(solid.add(letters));
    }
    const status = solid.status();
    if (status !== "NoError") throw Error("Geometry kernel: " + status);
    const mesh = solid.getMesh(),
      positions = [];
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp)
      positions.push(...mesh.vertProperties.slice(i, i + 3));
    const result = {
      positions,
      indices: Array.from(mesh.triVerts),
      version: VERSION,
      family,
      params: { ...p },
    };
    result.checks = checkMesh(result, dimensions(family, p));
    return result;
  } finally {
    for (const o of allocated.reverse()) o.delete();
  }
}
export function checkMesh(mesh, expected) {
  const p = mesh.positions,
    ind = mesh.indices,
    edges = new Map(),
    vertexKeys = [];
  let degenerates = 0,
    volume = 0;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    vertexKeys.push(
      p
        .slice(i, i + 3)
        .map((x) => Math.round(x * 1e5))
        .join(","),
    );
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
  for (let i = 0; i < ind.length; i += 3) {
    const [a, b, c] = ind.slice(i, i + 3).map((j) => p.slice(j * 3, j * 3 + 3));
    const u = b.map((v, k) => v - a[k]),
      v = c.map((v, k) => v - a[k]);
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    if (Math.hypot(...n) < 1e-9) degenerates++;
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    for (let j = 0; j < 3; j++) {
      const x = vertexKeys[ind[i + j]],
        y = vertexKeys[ind[i + ((j + 1) % 3)]],
        key = [x, y].sort().join("|");
      const e = edges.get(key) || { count: 0, direction: 0 };
      e.count++;
      e.direction += x < y ? 1 : -1;
      edges.set(key, e);
    }
  }
  const bounds = max.map((v, i) => v - min[i]),
    badEdges = [...edges.values()].filter(
      (e) => e.count !== 2 || e.direction !== 0,
    ).length;
  const finite = p.every(Number.isFinite),
    dimensionMatch =
      !expected || bounds.every((x, i) => Math.abs(x - expected[i]) < 0.02);
  return {
    valid:
      finite &&
      degenerates === 0 &&
      badEdges === 0 &&
      volume > 0 &&
      dimensionMatch,
    finite,
    degenerateFaces: degenerates,
    invalidEdges: badEdges,
    volumeMm3: volume,
    dimensionsMm: bounds,
    dimensionMatch,
    triangles: ind.length / 3,
    kernel: "Manifold 3.5.4",
    units: "mm",
  };
}
export function stl(mesh) {
  if (!mesh.checks.valid) throw Error("Mesh checks failed");
  const out = new Uint8Array(84 + (mesh.indices.length / 3) * 50),
    dv = new DataView(out.buffer);
  new TextEncoder().encodeInto(
    "Printelligent; millimeters; " + VERSION,
    out.subarray(0, 80),
  );
  dv.setUint32(80, mesh.indices.length / 3, true);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    let o = 84 + (i / 3) * 50;
    const [a, b, c] = mesh.indices
        .slice(i, i + 3)
        .map((j) => mesh.positions.slice(j * 3, j * 3 + 3)),
      u = b.map((x, k) => x - a[k]),
      v = c.map((x, k) => x - a[k]);
    let n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      l = Math.hypot(...n);
    for (const value of [...n.map((x) => x / l), ...a, ...b, ...c]) {
      dv.setFloat32(o, value, true);
      o += 4;
    }
  }
  return out;
}
