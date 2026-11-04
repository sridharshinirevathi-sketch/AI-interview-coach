import { describe, expect, it } from 'vitest'
import { analyzeResume, extractResumeText } from './localAnalysis'

describe('resume analysis', () => {
  it('extracts and scores uploaded text resumes', async () => {
    const file = new File([
      'SUMMARY Product designer with five years of experience.\n' +
        'SKILLS React JavaScript research communication\n' +
        'EXPERIENCE - Improved project delivery by 25%.\n' +
        'EDUCATION Design degree.',
    ], 'resume.txt', { type: 'text/plain' })

    const text = await extractResumeText(file)
    const result = analyzeResume(text)

    expect(text).toContain('SUMMARY')
    expect(result.score).toBeGreaterThan(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.keywords).toContain('react')
  })

  it('rejects resumes without readable text', () => {
    expect(() => analyzeResume('  ')).toThrow('The selected file does not contain readable text.')
  })
})
