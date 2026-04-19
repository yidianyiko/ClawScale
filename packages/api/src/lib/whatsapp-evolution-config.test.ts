import { describe, expect, it } from 'vitest';

import {
  buildPublicWhatsAppEvolutionConfig,
  parseStoredWhatsAppEvolutionConfig,
} from './whatsapp-evolution-config.js';

describe('whatsapp evolution config helpers', () => {
  it('parses stored instanceName and webhookToken', () => {
    expect(
      parseStoredWhatsAppEvolutionConfig({
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'token_1',
      }),
    ).toEqual({
      instanceName: 'coke-whatsapp-personal',
      webhookToken: 'token_1',
    });
  });

  it('builds a public config without exposing webhookToken', () => {
    expect(
      buildPublicWhatsAppEvolutionConfig({
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'token_1',
      }),
    ).toEqual({
      instanceName: 'coke-whatsapp-personal',
    });
  });

  it('rejects invalid stored configs', () => {
    expect(() => parseStoredWhatsAppEvolutionConfig({ instanceName: 'coke-whatsapp-personal' })).toThrow(
      'invalid_whatsapp_evolution_config:webhookToken',
    );
    expect(() => parseStoredWhatsAppEvolutionConfig({ webhookToken: 'token_1' })).toThrow(
      'invalid_whatsapp_evolution_config:instanceName',
    );
  });
});
