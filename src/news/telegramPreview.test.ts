import { describe, expect, it } from 'vitest'
import { cleanPostText, isPromotional, parseTelegramPreview, postToRawArticle } from './telegramPreview'
import type { FirstHandProfile } from './types'

// The fixture reproduces the structure of real t.me/s pages (inspected live 2026-09-23): the bubble-tail SVG, the
// `tgme_widget_message_wrap` blocks, the album whose text container is nested in another with the same class, the reply
// quote, the forward header, and tg-emoji/regional-indicator markup. Not a snapshot of a real page — hand-built, so each
// case is named for what it is checking.

const SVG = '<svg class="bubble_icon"><g><path d="M8,1 L9,1"></path></g></svg>'
const emoji = (e: string) => `<i class="emoji" style="background-image:url('//telegram.org/img/emoji/40/x.png')"><b>${e}</b></i>`

function post(id: number, time: string, body: string, channel = 'testchannel'): string {
  return `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${channel}/${id}" data-view="abc"><div class="tgme_widget_message_bubble"><i class="tgme_widget_message_bubble_tail">${SVG}</i>${body}<div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/${channel}/${id}"><time datetime="${time}" class="time">12:00</time></a></div></div></div></div>`
}
const text = (inner: string) => `<div class="tgme_widget_message_text js-message_text" dir="auto">${inner}</div>`
const video = `<a class="tgme_widget_message_video_player js-message_video_player" href="https://t.me/testchannel/1"><i class="tgme_widget_message_video_thumb" style="background-image:url('https://cdn4.telesco.pe/file/x.jpg')"></i><video src="https://cdn4.telesco.pe/file/x.mp4?token=1" class="tgme_widget_message_video js-message_video"></video></a>`
const photo = `<a class="tgme_widget_message_photo_wrap" href="https://t.me/testchannel/1" style="background-image:url('https://cdn4.telesco.pe/file/p.jpg')"></a>`

const page = (...posts: string[]) => `<html><body><section class="tgme_channel_history js-message_history">${posts.join('')}</section></body></html>`

const profile = (over: Partial<FirstHandProfile> = {}): FirstHandProfile => ({
  id: 'test-channel',
  name: 'Test Channel',
  sourceType: 'first-hand',
  label: 'First-hand account',
  channel: 'testchannel',
  channelTier: 'osint-aggregator',
  vetting: 'confirmed',
  ...over,
})

describe('parseTelegramPreview', () => {
  it('reads id, url, time and text, and decodes entities and line breaks', () => {
    const [p] = parseTelegramPreview(page(post(101, '2026-09-23T14:00:38+00:00', text('Serbia&#39;s President:<br/>Not a single soldier<br/><br/>left Serbia &amp; none returned'))))
    expect(p).toMatchObject({ channel: 'testchannel', id: 101, url: 'https://t.me/testchannel/101', publishedAt: '2026-09-23T14:00:38.000Z', hasVideo: false })
    expect(p.text).toBe("Serbia's President:\nNot a single soldier\n\nleft Serbia & none returned")
  })

  it('returns posts in page order and reads several', () => {
    const posts = parseTelegramPreview(page(post(1, '2026-09-23T10:00:00+00:00', text('one')), post(2, '2026-09-23T11:00:00+00:00', text('two'))))
    expect(posts.map((p) => p.id)).toEqual([1, 2])
  })

  it('an album\'s nested text container yields the inner text, not the wrapper markup', () => {
    const album = `<div class="tgme_widget_message_grouped_wrap">${photo}${photo}</div>${text(text('Syrian President meets Dutch PM in New York.'))}`
    const [p] = parseTelegramPreview(page(post(7, '2026-09-23T10:00:00+00:00', album)))
    expect(p.text).toBe('Syrian President meets Dutch PM in New York.')
  })

  it("a reply's quoted snippet is not the post's text", () => {
    const reply = `<a class="tgme_widget_message_reply js-message_reply" href="https://t.me/testchannel/5"><span class="tgme_widget_message_author_name">Someone</span><div class="tgme_widget_message_metatext">the quoted message</div></a>`
    const [p] = parseTelegramPreview(page(post(8, '2026-09-23T10:00:00+00:00', reply + text('The actual reply text'))))
    expect(p.text).toBe('The actual reply text')
  })

  it('detects video (including a round video), and does not mistake a photo for one', () => {
    const [v, r, ph] = parseTelegramPreview(
      page(
        post(1, '2026-09-23T10:00:00+00:00', video + text('clip')),
        post(2, '2026-09-23T10:01:00+00:00', '<a class="tgme_widget_message_roundvideo_player" href="x"></a>'),
        post(3, '2026-09-23T10:02:00+00:00', photo + text('picture')),
      ),
    )
    expect([v.hasVideo, r.hasVideo, ph.hasVideo]).toEqual([true, true, false])
  })

  it('records who a forward came from', () => {
    const fwd = `<div class="tgme_widget_message_forwarded_from accent_color">Forwarded from&nbsp;<a class="tgme_widget_message_forwarded_from_name" href="https://t.me/MaxOsintIntel/22754"><span dir="auto">MaxOsint Intel</span></a></div>`
    const [p] = parseTelegramPreview(page(post(9, '2026-09-23T10:00:00+00:00', fwd + text('Forwarded story'))))
    expect(p.forwardedFrom).toBe('MaxOsint Intel')
  })

  it('reads a photo or a video thumbnail as mediaUrl, decoding entities, and none when there is no media', () => {
    const [ph, vid, none] = parseTelegramPreview(
      page(
        post(1, '2026-09-23T10:00:00+00:00', photo.replace('p.jpg', 'p.jpg?a=1&amp;b=2') + text('picture')),
        post(2, '2026-09-23T10:01:00+00:00', video),
        post(3, '2026-09-23T10:02:00+00:00', text('words only')),
      ),
    )
    expect(ph.mediaUrl).toBe('https://cdn4.telesco.pe/file/p.jpg?a=1&b=2')
    expect(vid.mediaUrl).toBe('https://cdn4.telesco.pe/file/x.jpg')
    expect(none).not.toHaveProperty('mediaUrl')
  })

  it('gives a page with no posts back as an empty list, and ignores a block with no data-post', () => {
    expect(parseTelegramPreview('<html><body>Channel with preview disabled</body></html>')).toEqual([])
    expect(parseTelegramPreview('<div class="tgme_widget_message_wrap"><div>service</div></div>')).toEqual([])
  })

  it('takes the post time from the post, and omits it when the page has none rather than inventing one', () => {
    const noTime = post(3, 'not-a-date', text('x'))
    expect(parseTelegramPreview(page(noTime))[0]).not.toHaveProperty('publishedAt')
  })
})

describe('cleanPostText', () => {
  it('strips emoji and flags, and the dash they leave behind', () => {
    expect(cleanPostText(`${emoji('🇷🇺')}${emoji('❌')} — A massive drone strike on Kyiv`.replace(/<[^>]*>/g, ''))).toBe('A massive drone strike on Kyiv')
    expect(cleanPostText('🇺🇸🇮🇷⚡️ — NEW: talks collapse')).toBe('NEW: talks collapse')
  })

  it("drops t.me links and a trailing channel signature, but keeps an inline @mention (someone being quoted)", () => {
    expect(cleanPostText('Talks collapse – Yonhap @Middle_East_Spectator')).toBe('Talks collapse – Yonhap')
    expect(cleanPostText('Posted by @realPerson on the platform today')).toBe('Posted by @realPerson on the platform today')
    expect(cleanPostText('Story https://t.me/somechannel/123 continues')).toBe('Story continues')
  })

  it('removes subscribe/follow lines and blank lines, keeps real ones', () => {
    expect(cleanPostText('Strike hit port\n\nSubscribe to our channel\n\nFollow us for more\nOfficials confirm')).toBe('Strike hit port\nOfficials confirm')
  })

  it('keeps non-Latin text intact', () => {
    expect(cleanPostText('🇺🇦 Мапу оновлено')).toBe('Мапу оновлено')
  })
})

describe('isPromotional', () => {
  it('flags solicitations, not news that mentions money', () => {
    expect(isPromotional('Support my reporting: https://buymeacoffee.com/x')).toBe(true)
    expect(isPromotional('Use code ATLAS for 20% off')).toBe(true)
    expect(isPromotional('Musk says he will donate $1bn to the cause')).toBe(false)
    expect(isPromotional('The president used code words in the speech')).toBe(false)
  })
})

describe('postToRawArticle', () => {
  const fromHtml = (body: string, p = profile()) => postToRawArticle(parseTelegramPreview(page(post(50, '2026-09-23T10:00:00+00:00', body)))[0], p)

  it('maps a text post to the archive record, keyed to the profile and the post URL', () => {
    expect(fromHtml(text('Explosion reported in Kyiv'))).toEqual({
      sourceId: 'test-channel',
      title: 'Explosion reported in Kyiv',
      url: 'https://t.me/testchannel/50',
      publishedAt: '2026-09-23T10:00:00.000Z',
    })
  })

  it('splits a multi-line post into a title and a description', () => {
    const a = fromHtml(text("Iran's President at the UNGA:<br/><br/>Iran does not accept that nuclear knowledge is a privilege.<br/>NO to nuclear weapons."))
    expect(a?.title).toBe("Iran's President at the UNGA:")
    expect(a?.description).toBe('Iran does not accept that nuclear knowledge is a privilege. NO to nuclear weapons.')
  })

  it('cuts an over-long first line at a word boundary and carries the rest in the description', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const a = fromHtml(text(long))
    expect(a!.title.length).toBeLessThanOrEqual(301)
    expect(a!.title.endsWith('…')).toBe(true)
    expect(`${a!.title.slice(0, -1)} ${a!.description}`.replace(/\s+/g, ' ')).toBe(long)
  })

  it("stamps the channel's language (absent = English), and carries forwarded-from", () => {
    expect(fromHtml(text('Мапу оновлено'), profile({ language: 'uk' }))).toMatchObject({ language: 'uk' })
    expect(fromHtml(text('Hello'))).not.toHaveProperty('language')
  })

  it('keeps a video-only post with an empty title (J: keep video), flagged, and never sets an image', () => {
    const a = fromHtml(video)
    expect(a).toMatchObject({ title: '', hasVideo: true, sourceId: 'test-channel' })
    expect(a).not.toHaveProperty('imageUrl')
    expect(a).not.toHaveProperty('description')
  })

  it('keeps the picture as mediaUrl — never imageUrl, which is what a card would render', () => {
    const a = fromHtml(photo + video + text('Caption'))
    expect(a).not.toHaveProperty('imageUrl')
    expect(a).toMatchObject({ mediaUrl: 'https://cdn4.telesco.pe/file/p.jpg' })
  })

  it('drops a photo-only post, a service message and an advertisement', () => {
    expect(fromHtml(photo)).toBeNull()
    expect(fromHtml('')).toBeNull()
    expect(fromHtml(text('Support us: https://buymeacoffee.com/x'))).toBeNull()
  })

  it('drops a post that is nothing but noise once cleaned, unless it has video', () => {
    expect(fromHtml(text('🇺🇸 https://t.me/somechannel/9'))).toBeNull()
    expect(fromHtml(video + text('🇺🇸 https://t.me/somechannel/9'))).toMatchObject({ title: '', hasVideo: true })
  })
})
