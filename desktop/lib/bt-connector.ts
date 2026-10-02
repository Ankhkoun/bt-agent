export type ConnectorCapability = "read" | "create" | "update" | "delete" | "watch" | "sync";

export interface ConnectorContext {
  signal?: AbortSignal;
  cursor?: string;
  expectedVersion?: string;
}

export interface ConnectorItem {
  id: string;
  title?: string;
  version?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  content?: unknown;
}

export interface Connector<T extends ConnectorItem = ConnectorItem> {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly ConnectorCapability[];
  authenticate?(context?: ConnectorContext): Promise<void>;
  healthCheck(context?: ConnectorContext): Promise<{ ok: boolean; message?: string }>;
  read(id: string, context?: ConnectorContext): Promise<T>;
  create?(item: T, context?: ConnectorContext): Promise<T>;
  update?(id: string, item: Partial<T>, context?: ConnectorContext): Promise<T>;
  delete?(id: string, context?: ConnectorContext): Promise<void>;
  watch?(context?: ConnectorContext): AsyncIterable<T>;
  sync?(context?: ConnectorContext): Promise<{ cursor?: string; items: T[] }>;
}

export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  register(connector: Connector): void {
    if (!/^[a-z][a-z0-9.-]{1,63}$/.test(connector.id)) throw new Error("Connector id 无效");
    if (this.connectors.has(connector.id)) throw new Error(`Connector 已存在：${connector.id}`);
    this.connectors.set(connector.id, connector);
  }

  get(id: string): Connector | undefined { return this.connectors.get(id); }
  list(): Connector[] { return [...this.connectors.values()]; }

  async healthCheck(context?: ConnectorContext): Promise<Array<{ id: string; ok: boolean; message?: string }>> {
    return Promise.all(this.list().map(async (connector) => {
      const result = await connector.healthCheck(context);
      return { id: connector.id, ok: result.ok, ...(result.message ? { message: result.message } : {}) };
    }));
  }
}
