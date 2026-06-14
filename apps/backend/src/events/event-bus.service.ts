import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface AppEvent {
  type: 'new_message' | 'conversation_updated' | 'message_status';
  tenantId: string;
  payload: any;
}

@Injectable()
export class EventBusService {
  private emitter = new EventEmitter();

  constructor() {
    // Aumentar el límite para manejar muchas conexiones SSE simultáneas
    this.emitter.setMaxListeners(200);
  }

  publish(event: AppEvent) {
    this.emitter.emit('app_event', event);
  }

  subscribe(handler: (event: AppEvent) => void): () => void {
    this.emitter.on('app_event', handler);
    return () => this.emitter.off('app_event', handler);
  }
}
