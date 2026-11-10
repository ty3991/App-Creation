const engine = import("/shared/geometry.js");
self.onmessage = async ({ data }) => {
  try {
    const { generate } = await engine;
    self.postMessage({ id: data.id, mesh: generate(data.family, data.params) });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message, errors: e.errors });
  }
};
