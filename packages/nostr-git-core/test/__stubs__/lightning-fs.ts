// Minimal LightningFS stub for tests
export default class LightningFS {
  name: string;
  constructor(name?: string) {
    this.name = name || 'memfs';
  }
}
