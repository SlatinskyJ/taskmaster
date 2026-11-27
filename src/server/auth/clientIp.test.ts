import { describe, expect, it } from 'vitest'
import { ipBucket } from './clientIp'

describe('ipBucket', () => {
  it('keeps an IPv4 address as is', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7')
  })

  it('takes the IPv4 address out of an IPv4-mapped one', () => {
    expect(ipBucket('::ffff:203.0.113.7')).toBe('203.0.113.7')
  })

  it('counts every address of one IPv6 /64 as one visitor', () => {
    const a = ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd')
    expect(a).toBe('2001:db8:1:2::/64')
    expect(ipBucket('2001:0db8:0001:0002::1')).toBe(a)
    expect(ipBucket('2001:db8:1:2::1%eth0')).toBe(a)
  })

  it('tells two /64s apart', () => {
    expect(ipBucket('2001:db8:1:3::1')).not.toBe(ipBucket('2001:db8:1:2::1'))
  })

  it('expands a short form with :: on the left', () => {
    expect(ipBucket('::1')).toBe('0:0:0:0::/64')
  })

  it('keeps anything that does not parse as is', () => {
    for (const bad of ['unknown', '1:2:3', '1::2::3', '2001:db8::zzzz', '1:2:3:4:5:6:7:8:9']) {
      expect(ipBucket(bad)).toBe(bad)
    }
  })
})
