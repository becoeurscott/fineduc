/**
 * The root of the public app is intentionally not a page.
 *
 * Everything here is reached by a tokenised link. A landing page would only
 * ever be found by someone probing, and would tell them this host exists and
 * what it is for.
 */
import { notFound } from 'next/navigation'

export default function Index() {
  notFound()
}
