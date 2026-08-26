import Studio from '@/components/Studio'

export const metadata = {
  title: 'Studio — PixelPlace',
  description:
    'Write PixelCraft by hand or hand the tools to your agent. The compiler runs in your browser.'
}

// Deliberately static. The studio used to read public/gallery/<slug>.pc on the server
// so an ?example= link painted correctly on first render — but that path is built from
// the query string, so Next's file tracer cannot see it and would ship the function
// without those files. On a serverless host every gallery link would then silently
// open the starter program instead.
//
// The client already fetches example sources for load_example, so it does that here
// too. Nothing on this page needs a server, which is the claim the README makes.
export default function StudioPage() {
  return <Studio />
}
