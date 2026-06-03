// Minimal context stub for tests
export const context = {
  loading(message: string) {
    return `id:${message}`;
  },
  update(id: string, _data: any) {
    // no-op
  },
};
