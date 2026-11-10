import * as T from "/vendor/three/build/three.module.js";
import { OrbitControls } from "/vendor/OrbitControls.js";
export class Viewer {
  constructor(host) {
    this.host = host;
    this.scene = new T.Scene();
    this.scene.background = new T.Color("#eeece7");
    this.camera = new T.PerspectiveCamera(36, 1, 0.1, 5000);
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D model. Drag to rotate, pinch or scroll to zoom. Use arrow keys to rotate and plus or minus to zoom.",
    );
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 1800;
    this.scene.add(new T.HemisphereLight(0xffffff, 0x7c798a, 2.4));
    const light = new T.DirectionalLight(0xffffff, 3);
    light.position.set(-100, 200, 150);
    this.scene.add(light);
    const grid = new T.GridHelper(500, 25, 0xc7c5bf, 0xe0ddd7);
    grid.position.y = -0.2;
    this.scene.add(grid);
    this.group = new T.Group();
    this.scene.add(this.group);
    this.size = [160, 60, 4.2];
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.reset();
    this.renderer.domElement.addEventListener("keydown", (e) => {
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "+",
          "-",
          "=",
        ].includes(e.key)
      ) {
        e.preventDefault();
        const offset = this.camera.position.clone().sub(this.controls.target),
          s = new T.Spherical().setFromVector3(offset);
        if (e.key === "ArrowLeft") s.theta -= 0.1;
        if (e.key === "ArrowRight") s.theta += 0.1;
        if (e.key === "ArrowUp") s.phi = Math.max(0.1, s.phi - 0.1);
        if (e.key === "ArrowDown") s.phi = Math.min(3, s.phi + 0.1);
        if (["+", "="].includes(e.key)) s.radius *= 0.9;
        if (e.key === "-") s.radius *= 1.1;
        this.camera.position.copy(
          new T.Vector3().setFromSpherical(s).add(this.controls.target),
        );
      }
    });
    this.running = true;
    const animate = () => {
      if (!this.running) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(animate);
    };
    animate();
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  reset() {
    const scale = Math.max(...this.size) * 1.7;
    this.controls.target.set(0, this.size[2] / 2, 0);
    this.camera.position.set(scale * 0.65, scale * 0.9, scale * 1.1);
    this.controls.update();
  }
  clear() {
    for (const m of [...this.group.children]) {
      m.geometry.dispose();
      m.material.dispose();
      this.group.remove(m);
    }
  }
  setMesh(mesh, color) {
    this.clear();
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(mesh.positions, 3));
    g.setIndex(mesh.indices);
    g.computeVertexNormals();
    const mat = new T.MeshStandardMaterial({
      color,
      roughness: 0.64,
      metalness: 0.03,
      flatShading: true,
    });
    const m = new T.Mesh(g, mat);
    m.rotation.x = -Math.PI / 2;
    this.group.add(m);
    this.size = mesh.checks.dimensionsMm;
    this.renderer.render(this.scene, this.camera);
  }
  envelope(values, color) {
    this.clear();
    this.size = [values.width ?? 60, values.depth ?? 40, values.height ?? 20];
    const g = new T.BoxGeometry(this.size[0], this.size[2], this.size[1]);
    const m = new T.Mesh(
      g,
      new T.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.35,
        wireframe: true,
      }),
    );
    m.position.y = this.size[2] / 2;
    this.group.add(m);
  }
  color(c) {
    for (const m of this.group.children) m.material.color.set(c);
  }
  snapshot() {
    this.renderer.render(this.scene, this.camera);
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 550;
    canvas.getContext("2d").drawImage(this.renderer.domElement, 0, 0, 800, 550);
    return canvas.toDataURL("image/png");
  }
  dispose() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
  }
}
