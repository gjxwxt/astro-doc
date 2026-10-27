import { describe, expect, it } from 'vitest';

import { parseGequPage, parseGequSearch } from '../src/lib/music/gequ';
import { filterNeteaseRelevance, parseNeteaseSearch } from '../src/lib/music/netease';
import { formatDuration, sanitizeName } from '../src/lib/music/utils';

describe('parseGequSearch', () => {
  const html = `
    <table class="table" id="myTables">
      <tbody>
        <tr><th>序号</th><th>歌曲</th><th>歌手</th></tr>
        <tr>
          <td>1</td>
          <td><a href="/play/326">晴天</a></td>
          <td>周杰伦</td>
        </tr>
        <tr>
          <td>2</td>
          <td><a href="/play/553">青花瓷</a></td>
          <td>周杰伦</td>
        </tr>
      </tbody>
    </table>`;

  it('extracts gequhai rows and stops at the limit', () => {
    const rows = parseGequSearch(html, 'gequhai', 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'gequhai',
      sourceLabel: '歌曲海',
      id: '326',
      title: '晴天',
      artist: '周杰伦',
    });
  });

  it('extracts gequke song links', () => {
    const rows = parseGequSearch(html.replaceAll('/play/', '/song/'), 'gequke', 5);
    expect(rows.map((row) => row.id)).toEqual(['326', '553']);
    expect(rows[1].title).toBe('青花瓷');
  });
});

describe('parseGequPage', () => {
  const html = `
    <script>
      window.play_id = 'abc123';
      window.mp3_type = 0;
      window.mp3_title = '晴天';
      window.mp3_author = '周杰伦';
      window.mp3_cover = 'https://img.example/cover.jpg';
    </script>
    <div class="content-lrc" id="content-lrc">fallback</div>
    <div style="display:none" id="content-lrc2">
      [00:00.00]晴天 - 周杰伦<br />
      [00:02.00]词：周杰伦<br />
      [00:04.00]故事的小黄花
    </div>`;

  it('reads play token, metadata and LRC', () => {
    const page = parseGequPage(html);
    expect(page.playId).toBe('abc123');
    expect(page.type).toBe(0);
    expect(page.title).toBe('晴天');
    expect(page.artist).toBe('周杰伦');
    expect(page.lyrics).toContain('[00:00.00]晴天 - 周杰伦');
    expect(page.lyrics).toContain('故事的小黄花');
    expect(page.lyrics).not.toContain('<br');
  });
});

describe('parseNeteaseSearch', () => {
  it('normalizes song metadata', () => {
    const rows = parseNeteaseSearch({
      result: {
        songs: [
          {
            id: 123,
            name: '晴天',
            duration: 269000,
            artists: [{ name: '周杰伦' }, { name: 'Jay Chou' }],
            album: { name: '叶惠美', picUrl: 'http://img.example/cover.jpg' },
          },
        ],
      },
    });
    expect(rows[0]).toMatchObject({
      source: 'netease',
      sourceLabel: '网易云',
      id: '123',
      title: '晴天',
      artist: '周杰伦 / Jay Chou',
      album: '叶惠美',
      duration: 269,
      cover: 'https://img.example/cover.jpg',
    });
  });
});

describe('filterNeteaseRelevance', () => {
  const tracks = parseNeteaseSearch({
    result: {
      songs: [
        { id: 1, name: 'Feather', artists: [{ name: 'Haruka Nakamura' }] },
        { id: 2, name: 'Feather (feat. Cise Starr)', artists: [{ name: 'Nujabes' }] },
      ],
    },
  });

  it('keeps fuzzy results that share a Latin token', () => {
    expect(filterNeteaseRelevance(tracks, 'Nujabes Feather')).toHaveLength(2);
  });

  it('drops results that do not share the query at all', () => {
    expect(filterNeteaseRelevance(tracks, '不存在的歌名zzzz')).toHaveLength(0);
  });
});

describe('music filenames', () => {
  it('keeps Chinese names but strips unsafe characters', () => {
    expect(sanitizeName('周杰伦 / 晴天:*?')).toBe('周杰伦 晴天');
    expect(sanitizeName('   ', 'music')).toBe('music');
  });

  it('formats durations', () => {
    expect(formatDuration(269)).toBe('4:29');
    expect(formatDuration(0)).toBe('');
  });
});
