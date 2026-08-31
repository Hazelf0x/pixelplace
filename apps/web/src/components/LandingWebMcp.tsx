'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ok, registerTools, type WebMcpTool } from '@/lib/webmcp'

/**
 * Give an agent arriving at the public gallery one unambiguous doorway into the
 * stateful workspace. The editing tools deliberately stay in the Studio, where
 * their source, canvas, history and visible activity feed actually exist.
 */
export default function LandingWebMcp() {
  const router = useRouter()

  useEffect(() => {
    const controller = new AbortController()
    const tools: WebMcpTool[] = [
      {
        name: 'open_pixelplace_studio',
        description:
          'Open PixelPlace Studio, where the full WebMCP toolset can create, inspect, revise, ' +
          'animate, and export game-ready pixel art. Call this before trying to edit artwork.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { destructiveHint: false, idempotentHint: true },
        execute: async () => {
          router.push('/studio')
          return ok({
            destination: '/studio',
            message: 'Opening PixelPlace Studio. Its creation and editing tools will become available there.'
          })
        }
      }
    ]

    void registerTools(tools, controller.signal)
    return () => controller.abort()
  }, [router])

  return null
}
