import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./execute', () => ({ executeClinicalTool: vi.fn() }))

import { runOpenAiAgent } from './loop-openai'
import { executeClinicalTool } from './execute'
import type { AgentToolContext } from './tools'
import type { ChatMessage } from '../types'

const execMock = vi.mocked(executeClinicalTool)

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response
}

const CTX = {} as AgentToolContext
const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'me das precios?' }]
const baseArgs = {
  provider: 'openai' as const,
  apiKey: 'sk-test',
  model: 'o4-mini',
  systemPrompt: 'system',
  messages: MESSAGES,
  ctx: CTX,
}

describe('runOpenAiAgent', () => {
  beforeEach(() => execMock.mockReset())
  afterEach(() => vi.unstubAllGlobals())

  it('ejecuta una function-call y devuelve el texto final', async () => {
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
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'consultar_catalogo', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'La valoración cuesta $500!' },
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const res = await runOpenAiAgent(baseArgs)
    expect(res.text).toBe('La valoración cuesta $500!')
    expect(res.escalated).toBe(false)
    expect(execMock).toHaveBeenCalledWith('consultar_catalogo', {}, CTX)

    // La segunda llamada debe reenviar el resultado como role:'tool'.
    const body = JSON.parse(fetchMock.mock.calls[1][1].body)
    const toolMsg = body.messages.at(-1)
    expect(toolMsg.role).toBe('tool')
    expect(toolMsg.tool_call_id).toBe('call_1')
    // Y las tools van en formato function.
    expect(body.tools[0].type).toBe('function')
    expect(body.tools[0].function.name).toBe('consultar_catalogo')
  })

  it('propaga escalated y parsea argumentos JSON', async () => {
    execMock.mockResolvedValue({
      content: JSON.stringify({ ok: true, escalado: true }),
      escalated: true,
    })
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
                  {
                    id: 'c1',
                    type: 'function',
                    function: {
                      name: 'escalar_a_humano',
                      arguments: '{"motivo":"pide doctor"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          choices: [
            { finish_reason: 'stop', message: { role: 'assistant', content: 'Ya te contactan!' } },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const res = await runOpenAiAgent(baseArgs)
    expect(res.escalated).toBe(true)
    expect(execMock).toHaveBeenCalledWith(
      'escalar_a_humano',
      { motivo: 'pide doctor' },
      CTX,
    )
  })

  it('responde sin herramientas cuando cierra de una', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fakeResponse({
        choices: [
          { finish_reason: 'stop', message: { role: 'assistant', content: 'Hola! Con quién tengo el gusto?' } },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await runOpenAiAgent(baseArgs)
    expect(res.text).toContain('gusto')
    expect(execMock).not.toHaveBeenCalled()
  })
})
