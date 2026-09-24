import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as path from 'path';
import { DEFAULT_INSTANCES_DIR, InstanceInfo, PASSTHROUGH, ReviewDecision, ReviewRequest } from './protocol';

export type ReviewHandler = (request: ReviewRequest, signal: AbortSignal) => Promise<ReviewDecision>;

const MAX_BODY_BYTES = 50 * 1024 * 1024;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Removes instance files left behind by VS Code windows that crashed. */
function removeStaleInstances(dir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const { pid } = JSON.parse(fs.readFileSync(file, 'utf8')) as InstanceInfo;
      if (!isProcessAlive(pid)) fs.unlinkSync(file);
    } catch {
      // Leave anything unreadable alone.
    }
  }
}

/**
 * Localhost endpoint the Claude Code hook posts proposed edits to. It holds
 * each request open until the handler decides, and aborts the handler's signal
 * if the hook goes away first (Claude Code timed out or the user interrupted).
 */
export class ReviewServer {
  private server: http.Server | undefined;
  private instanceFile: string | undefined;
  private readonly token = randomBytes(24).toString('hex');
  private port = 0;

  constructor(
    private readonly handler: ReviewHandler,
    private folders: string[],
    private readonly instancesDir: string = DEFAULT_INSTANCES_DIR
  ) {}

  async start(): Promise<void> {
    removeStaleInstances(this.instancesDir);
    const server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    fs.mkdirSync(this.instancesDir, { recursive: true, mode: 0o700 });
    this.instanceFile = path.join(this.instancesDir, `${process.pid}-${this.port}.json`);
    this.writeInstanceFile();
  }

  updateFolders(folders: string[]): void {
    this.folders = folders;
    if (this.instanceFile) this.writeInstanceFile();
  }

  stop(): void {
    if (this.instanceFile) {
      try {
        fs.unlinkSync(this.instanceFile);
      } catch {
        // Already gone.
      }
      this.instanceFile = undefined;
    }
    if (this.server) {
      this.server.close();
      this.server.closeAllConnections();
      this.server = undefined;
    }
  }

  private writeInstanceFile(): void {
    const info: InstanceInfo = { port: this.port, token: this.token, pid: process.pid, folders: this.folders };
    fs.writeFileSync(this.instanceFile!, JSON.stringify(info), { mode: 0o600 });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST' || req.url !== '/review' || req.headers.authorization !== `Bearer ${this.token}`) {
      res.writeHead(403).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      let request: ReviewRequest;
      try {
        request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ReviewRequest;
      } catch {
        res.writeHead(400).end();
        return;
      }
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      this.handler(request, controller.signal)
        .catch(() => PASSTHROUGH)
        .then((decision) => {
          if (!res.writableEnded && !controller.signal.aborted) {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(decision));
          }
        });
    });
  }
}
