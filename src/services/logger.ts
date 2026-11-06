import fs from 'fs';
import path from 'path';

class ForensicLogger {
  private logsDir: string;
  private currentLogFile: string;

  constructor() {
    this.logsDir = path.join(process.cwd(), 'logs');
    this.ensureDirectory();
    const dateStr = new Date().toISOString().split('T')[0];
    this.currentLogFile = path.join(this.logsDir, `forensic_${dateStr}.txt`);
  }

  private ensureDirectory() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private formatMessage(level: string, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    let formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    if (meta !== undefined) {
      if (meta instanceof Error) {
        formatted += `\n  STACK: ${meta.stack || meta.message}`;
      } else if (typeof meta === 'object') {
        try {
          formatted += `\n  DATA: ${JSON.stringify(meta, null, 2)}`;
        } catch (_) {
          formatted += `\n  DATA: ${String(meta)}`;
        }
      } else {
        formatted += `\n  DATA: ${String(meta)}`;
      }
    }

    return formatted;
  }

  private writeToFile(line: string) {
    try {
      this.ensureDirectory();
      fs.appendFileSync(this.currentLogFile, line + '\n', 'utf-8');
    } catch (err) {
      console.error('Error escribiendo en log forense:', err);
    }
  }

  public log(level: string, message: string, meta?: any) {
    const formatted = this.formatMessage(level, message, meta);
    
    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }

    this.writeToFile(formatted);
  }

  public info(message: string, meta?: any) {
    this.log('INFO', message, meta);
  }

  public warn(message: string, meta?: any) {
    this.log('WARN', message, meta);
  }

  public error(message: string, error?: any, meta?: any) {
    const combinedMeta = error ? { error: error.stack || error, ...meta } : meta;
    this.log('ERROR', message, combinedMeta);
  }

  public debug(message: string, meta?: any) {
    this.log('DEBUG', message, meta);
  }

  public forensic(category: string, message: string, details?: any) {
    const header = `=== FORENSIC [${category.toUpperCase()}] ===`;
    this.log(header, message, details);
  }
}

export const logger = new ForensicLogger();
