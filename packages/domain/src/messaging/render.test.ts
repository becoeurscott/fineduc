import { describe, it, expect } from 'vitest'
import { render, placeholdersIn, assertTemplateSatisfiable, smsSegments } from './render.js'

describe('render', () => {
  it('substitutes a placeholder', () => {
    const result = render('Bonjour {{guardianName}}', { guardianName: 'Mme Mballa' })
    expect(result.body).toBe('Bonjour Mme Mballa')
    expect(result.missing).toEqual([])
  })

  it('substitutes several, including repeats', () => {
    const result = render('{{name}}, {{name}} doit {{amount}}', { name: 'Aïcha', amount: '50 000 FCFA' })
    expect(result.body).toBe('Aïcha, Aïcha doit 50 000 FCFA')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(render('Bonjour {{ name }}', { name: 'X' }).body).toBe('Bonjour X')
  })

  /**
   * "Bonjour , vous devez  FCFA" is worse than no message: it tells a family
   * the school does not know who they are, and nobody notices until a parent
   * forwards a screenshot.
   */
  it('reports a missing variable and leaves the placeholder visible', () => {
    const result = render('Bonjour {{name}}, vous devez {{amount}}', { name: 'Aïcha' })
    expect(result.missing).toEqual(['amount'])
    expect(result.body).toContain('{{amount}}')
    expect(result.body).not.toBe('Bonjour Aïcha, vous devez ')
  })

  it('reports each missing name once', () => {
    expect(render('{{a}} {{a}} {{b}}', {}).missing).toEqual(['a', 'b'])
  })

  it('leaves text with no placeholders alone', () => {
    expect(render('Rien à remplacer', {}).body).toBe('Rien à remplacer')
  })

  /** Not a template engine, deliberately: a body is not a place for code. */
  it('does not evaluate anything that looks like an expression', () => {
    const result = render('{{ 1 + 1 }}', {})
    expect(result.body).toBe('{{ 1 + 1 }}')
  })

  it('does not recurse into a substituted value', () => {
    const result = render('{{a}}', { a: '{{b}}' })
    expect(result.body).toBe('{{b}}')
    expect(result.missing).toEqual([])
  })
})

describe('placeholdersIn', () => {
  it('lists them once each, in order', () => {
    expect(placeholdersIn('{{a}} {{b}} {{a}}')).toEqual(['a', 'b'])
  })

  it('is empty for a plain body', () => {
    expect(placeholdersIn('bonjour')).toEqual([])
  })
})

describe('assertTemplateSatisfiable', () => {
  it('accepts a template using only known variables', () => {
    expect(() => assertTemplateSatisfiable('{{name}} {{amount}}', ['name', 'amount', 'dueOn'])).not.toThrow()
  })

  /**
   * Caught when the template is SAVED, not at 02:00 when a job fans it out
   * to four hundred families.
   */
  it('names the unknown variables and what is available', () => {
    expect(() => assertTemplateSatisfiable('{{name}} {{nickname}}', ['name', 'amount'])).toThrow(
      /\{\{nickname\}\}.*Available: name, amount/s,
    )
  })
})

describe('smsSegments', () => {
  it('counts a short plain message as one segment', () => {
    const result = smsSegments('Bonjour, votre paiement est du.')
    expect(result).toEqual({ segments: 1, encoding: 'GSM-7' })
  })

  it('fits 160 GSM-7 characters in one segment', () => {
    expect(smsSegments('a'.repeat(160)).segments).toBe(1)
    expect(smsSegments('a'.repeat(161)).segments).toBe(2)
  })

  /**
   * The costly surprise, and one that is easy to get backwards: `é è à`
   * are IN the GSM-7 set, so "échéance" and "scolarité" cost nothing extra.
   * Lowercase `ç` is NOT — so "reçu", a word this product sends on every
   * cash payment, flips the whole message to UCS-2 and more than halves the
   * segment size.
   */
  it('drops to 70 characters once a character forces UCS-2', () => {
    const result = smsSegments('Votre reçu ' + 'a'.repeat(100))
    expect(result.encoding).toBe('UCS-2')
    expect(result.segments).toBe(2)
  })

  it('counts a 70-character UCS-2 message as one segment', () => {
    expect(smsSegments('ç' + 'a'.repeat(69)).segments).toBe(1)
    expect(smsSegments('ç' + 'a'.repeat(70)).segments).toBe(2)
  })

  /** These look expensive and are not. Worth pinning so nobody "optimises" them away. */
  it.each(['échéance', 'élève', 'scolarité', 'à régler', 'Élève'])('keeps %s in GSM-7', (word) => {
    expect(smsSegments(word).encoding).toBe('GSM-7')
  })

  /** And these look harmless and are not. */
  it.each(['reçu', 'français', 'coût', 'être', 'Noël'])('forces %s to UCS-2', (word) => {
    expect(smsSegments(word).encoding).toBe('UCS-2')
  })

  it('is zero segments for an empty body', () => {
    expect(smsSegments('').segments).toBe(0)
  })

  it('counts by code point, so an emoji is not two characters', () => {
    expect(smsSegments('👍').segments).toBe(1)
  })
})
