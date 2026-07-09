import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./execute', () => ({ executeClinicalTool: vi.fn() }))

import { runClinicalAgent } from './loop'
import { executeClinicalTool } from './execute'
import type { AgentToolContext, RunClinicalAgentArgs } from './tools'
import type { ChatMessage } from '../types'

const execMock = vi.mocked(executeClinicalTool)

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response
}

const CTX = {} as AgentToolContext
const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'agéndame una cita' }]

function args(over: Partial<RunClinicalAgentArgs> = {}): RunClinicalAgentArgs {
  return {
    provider: 'openai',
    apiKey: 'sk-native',
    model: 'openclaw/coco',
    systemPrompt: 'system',
    messages: MESSAGES,
    ctx: CTX,
    ...over,
  }
}

const headersOf = (call: unknown[]) =>
  (call[1] as RequestInit).headers as Record<string, string>

describe('AgentHarness — dispatch por backend', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    execMock.mockReset()
  })

  it('backend openclaw → tool-loop contra el gateway (URL+token), ejecutando las tools de wacrm (gap cerrado)', async () => {
    execMock.mockResolvedValue({ content: JSON.stringify({ ok: true }) })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        fakeResponse({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  { id: 'c1', type: 'function', function: { name: 'agendar_cita', arguments: '{}' } },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Listo, cita pre-agendada' } }],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const res = await runClinicalAgent(
      args({ backend: 'openclaw', baseUrl: 'http://openclaw:18789/v1', authToken: 'gw-token' }),
    )

    expect(res.text).toBe('Listo, cita pre-agendada')
    // Pegó al GATEWAY externo, no a OpenAI, con el token del gateway.
    expect(fetchMock.mock.calls[0][0]).toBe('http://openclaw:18789/v1/chat/completions')
    expect(headersOf(fetchMock.mock.calls[0]).Authorization).toBe('Bearer gw-token')
    // Y ejecutó la tool de wacrm (contra Supabase) → sin gap de datos.
    expect(execMock).toHaveBeenCalledWith('agendar_cita', expect.anything(), CTX)
  })

  it('backend native (ausente) + provider openai → api.openai.com con la apiKey de la cuenta', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        fakeResponse({ choices: [{ finish_reason: 'stop', message: { content: 'nativo' } }] }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const res = await runClinicalAgent(args())

    expect(res.text).toBe('nativo')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions')
    expect(headersOf(fetchMock.mock.calls[0]).Authorization).toBe('Bearer sk-native')
  })
})
