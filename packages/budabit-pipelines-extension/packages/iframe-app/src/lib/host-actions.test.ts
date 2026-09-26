import {afterEach, describe, expect, it, vi} from 'vitest'
import {nip19} from 'nostr-tools'
import type {WidgetBridge} from 'budabit-sdk'
import {copyToClipboard, eventPath, navigateHost, profilePath} from './host-actions'

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

describe('host navigation and clipboard', () => {
  it('encodes event and profile routes for Budabit rather than OS protocol handlers', async () => {
    const id = 'a'.repeat(64)
    const path = eventPath(id, ['wss://relay.example', 'wss://relay.example'])
    expect(nip19.decode(path.slice(1))).toEqual({type: 'nevent', data: {id, relays: ['wss://relay.example']}})
    expect(profilePath(id)).toBe(`/people/${nip19.npubEncode(id)}`)
    const request = vi.fn().mockResolvedValue({status: 'ok'})
    await navigateHost({request} as unknown as WidgetBridge, path)
    expect(request).toHaveBeenCalledWith('ui:navigate', {path})
    request.mockResolvedValue({error: 'Permission denied'})
    await expect(navigateHost({request} as unknown as WidgetBridge, path)).rejects.toThrow('Permission denied')
  })

  it('uses delegated clipboard writes for both IDs and formatted JSON', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {clipboard: {writeText}})
    await copyToClipboard('a'.repeat(64))
    const json = JSON.stringify({id: 'a'.repeat(64), tags: [['e', 'b'.repeat(64)]]}, null, 2)
    await copyToClipboard(json)
    expect(writeText.mock.calls.map(([value]) => value)).toEqual(['a'.repeat(64), json])
  })

  it('falls back when policy blocks async clipboard and restores focus without swallowing failure', async () => {
    const writeText = vi.fn()
    vi.stubGlobal('navigator', {clipboard: {writeText}})
    const policy = {allowsFeature: () => false}
    Object.defineProperty(document, 'featurePolicy', {configurable: true, value: policy})
    const copy = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', {configurable: true, value: copy})
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    try {
      await copyToClipboard('fixture')
      expect(writeText).not.toHaveBeenCalled()
      expect(copy).toHaveBeenCalledWith('copy')
      expect(document.activeElement).toBe(button)
      expect(document.querySelector('textarea')).toBeNull()
      copy.mockReturnValue(false)
      await expect(copyToClipboard('fixture')).rejects.toThrow('Clipboard copy was blocked')
      expect(document.querySelector('textarea')).toBeNull()
    } finally {
      button.remove()
      Reflect.deleteProperty(document, 'featurePolicy')
      Reflect.deleteProperty(document, 'execCommand')
    }
  })
})
