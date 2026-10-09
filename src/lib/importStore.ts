// Stub: implemented in the next commit.
export function isValidImportId(_id: string): boolean {
  return true;
}

export class ImportStore {
  constructor(_dir: string) {}
  save(_content: any, _resolved: any): void {}
  get(_id: string): { content: any; resolved: any } | null {
    return null;
  }
  list(): any[] {
    return [];
  }
  remove(_id: string): boolean {
    return false;
  }
}
