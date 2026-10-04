export async function load(file: string) {
  const fixture = (window as any).nativeFixture ??= { refreshes: 0 };
  const stores = fixture.stores ??= {};
  const store = stores[file] ??= {};
  return {
    get: async (key: string) => store[key],
    set: async (key: string, value: unknown) => { store[key] = value; },
    delete: async (key: string) => { delete store[key]; },
    save: async () => {},
  };
}