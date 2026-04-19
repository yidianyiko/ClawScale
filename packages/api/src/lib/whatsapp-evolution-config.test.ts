import { describe, expect, it } from 'vitest';

import {
  buildPublicWhatsAppEvolutionConfig,
  ensureStoredWhatsAppEvolutionConfig,
  hasWhatsAppEvolutionWebhookToken,
  parseStoredWhatsAppEvolutionConfig,
  parseWhatsAppEvolutionConfig,
} from './whatsapp-evolution-config.js';

describe('whatsapp evolution config helpers', () => {
  it('parses instanceName and optional webhookToken', () => {
    expect(
      parseWhatsAppEvolutionConfig({
        instanceName: 'coke-whatsapp-personal',
      }),
    ).toEqual({
      instanceName: 'coke-whatsapp-personal',
      webhookToken: undefined,
    });

    expect(
      parseWhatsAppEvolutionConfig({
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'token_1',
      }),
    ).toEqual({
      instanceName: 'coke-whatsapp-personal',
      webhookToken: 'token_1',
    });
  });

  it('parses stored instanceName and webhookToken when both are present', () => {
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

  it('backfills missing webhookToken when materializing a stored config', () => {
    expect(
      ensureStoredWhatsAppEvolutionConfig(
        {
          instanceName: 'coke-whatsapp-personal',
        },
        () => 'generated_token_1',
      ),
    ).toEqual({
      instanceName: 'coke-whatsapp-personal',
      webhookToken: 'generated_token_1',
    });
  });

  it('reports whether a webhook token is present', () => {
    expect(
      hasWhatsAppEvolutionWebhookToken({
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'token_1',
      }),
    ).toBe(true);
    expect(
      hasWhatsAppEvolutionWebhookToken({
        instanceName: 'coke-whatsapp-personal',
      }),
    ).toBe(false);
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
    expect(() => parseWhatsAppEvolutionConfig({ webhookToken: 'token_1' })).toThrow(
      'invalid_whatsapp_evolution_config:instanceName',
    );
  });
});
