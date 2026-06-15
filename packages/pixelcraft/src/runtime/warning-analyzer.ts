import { ASTNode, Expr, FrameNode, Point, Program, ScalarValue } from '../lang/ast'
import { evaluateExpressionIntrinsic } from '../lang/expression-intrinsics'

export type WarningCode =
  | 'W001'
  | 'W002'
  | 'W003'
  | 'W004'
  | 'W005'
  | 'W006'
  | 'W007'
  | 'W008'
  | 'W009'
  | 'W010'
  | 'W011'
  | 'W014'
  | 'W015'
  | 'W016'

export interface ProgramWarning {
  code: WarningCode
  message: string
  line: number
  column: number
  hint?: string
}

export function analyzeProgramWarnings(program: Program): ProgramWarning[] {
  const warnings: ProgramWarning[] = []
  const groupDefinitions: Array<{ name: string; line: number; column: number }> = []
  const bitmapDefinitions: Array<{ name: string; line: number; column: number }> = []
  const tilesetDefinitions: Array<{ name: string; line: number; column: number; targets: string[] }> = []
  const tilemapDefinitions: Array<{ name: string; line: number; column: number; tilesetName: string }> = []
  const anchorDefinitions: Array<{ name: string; line: number; column: number }> = []
  const usedGroupTargets = new Set<string>()
  const usedBitmapTargets = new Set<string>()
  const usedStampLikeTargets = new Set<string>()
  const usedTilemaps = new Set<string>()
  const usedAnchors = new Set<string>()
  const frameNodes: FrameNode[] = []

  interface BoundingBox {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }

  interface FrameMetrics {
    drawCommands: number
    singlePixelCommands: number
    hasEmit: boolean
    signature: string
    bbox: BoundingBox | null
  }

  const addWarning = (
    code: WarningCode,
    message: string,
    line: number,
    column: number,
    hint?: string
  ): void => {
    warnings.push({ code, message, line, column, hint })
  }

  const markPointAnchorUsage = (point: Point): void => {
    if (point.anchorName) {
      usedAnchors.add(point.anchorName)
    }
  }

  const mergeBoxes = (a: BoundingBox | null, b: BoundingBox | null): BoundingBox | null => {
    if (!a) return b
    if (!b) return a
    return {
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY)
    }
  }

  const evalStaticExpr = (expr: Expr): number | null => {
    switch (expr.kind) {
      case 'literal':
        return expr.value
      case 'var':
      case 'pairVar':
        return null
      case 'unary': {
        const value = evalStaticExpr(expr.expr)
        if (value === null) return null
        return expr.op === '-' ? -value : value
      }
      case 'binary': {
        const left = evalStaticExpr(expr.left)
        const right = evalStaticExpr(expr.right)
        if (left === null || right === null) return null
        switch (expr.op) {
          case '+': return left + right
          case '-': return left - right
          case '*': return left * right
          case '/': return right === 0 ? null : left / right
          case '%': return right === 0 ? null : left % right
        }
      }
      case 'call': {
        const resolvedArgs: number[] = []
        for (const arg of expr.args) {
          const value = evalStaticExpr(arg)
          if (value === null) return null
          resolvedArgs.push(value)
        }
        return evaluateExpressionIntrinsic(expr.name, resolvedArgs)
      }
    }
  }

  const evalStaticScalar = (value: ScalarValue): number | null => {
    if (typeof value === 'number') return value
    return evalStaticExpr(value)
  }

  const pointBox = (x: number, y: number): BoundingBox => ({ minX: x, minY: y, maxX: x, maxY: y })

  const tryStaticPoint = (point: Point): { x: number; y: number } | null => {
    if (point.isCenter || point.isRelativeX || point.isRelativeY || point.anchorName) return null
    const x = evalStaticScalar(point.x)
    const y = evalStaticScalar(point.y)
    if (x === null || y === null) return null
    return { x: Math.trunc(x), y: Math.trunc(y) }
  }

  const tryStaticCoord = (
    x: ScalarValue,
    y: ScalarValue,
    isCenter: boolean,
    isRelativeX: boolean,
    isRelativeY: boolean,
    anchorName?: string
  ): { x: number; y: number } | null => {
    if (isCenter || isRelativeX || isRelativeY || anchorName) return null
    const resolvedX = evalStaticScalar(x)
    const resolvedY = evalStaticScalar(y)
    if (resolvedX === null || resolvedY === null) return null
    return { x: Math.trunc(resolvedX), y: Math.trunc(resolvedY) }
  }

  const analyzeFrameBody = (body: ASTNode[]): FrameMetrics => {
    let drawCommands = 0
    let singlePixelCommands = 0
    let hasEmit = false
    let bbox: BoundingBox | null = null
    const signatureParts: string[] = []

    const visitFrameNode = (node: ASTNode): void => {
      switch (node.kind) {
        case 'repeat':
          signatureParts.push(`repeat(${node.body.length})`)
          for (const stmt of node.body) visitFrameNode(stmt)
          return
        case 'pixel': {
          drawCommands++
          singlePixelCommands += node.points.length === 1 ? 1 : 0
          signatureParts.push(`px:${node.points.length}`)
          for (const point of node.points) {
            const staticPoint = tryStaticPoint(point)
            if (!staticPoint) continue
            bbox = mergeBoxes(bbox, pointBox(staticPoint.x, staticPoint.y))
          }
          return
        }
        case 'fill': {
          drawCommands++
          signatureParts.push(`fill:${node.points.length}`)
          for (const point of node.points) {
            const staticPoint = tryStaticPoint(point)
            if (!staticPoint) continue
            bbox = mergeBoxes(bbox, pointBox(staticPoint.x, staticPoint.y))
          }
          return
        }
        case 'rect':
        case 'orect': {
          drawCommands++
          signatureParts.push(node.kind)
          const origin = tryStaticCoord(node.x, node.y, node.isCenter, node.isRelativeX, node.isRelativeY, node.anchorName)
          const width = evalStaticScalar(node.width)
          const height = evalStaticScalar(node.height)
          if (!origin || width === null || height === null) return
          const w = Math.trunc(width)
          const h = Math.trunc(height)
          if (w <= 0 || h <= 0) return
          bbox = mergeBoxes(
            bbox,
            {
              minX: origin.x,
              minY: origin.y,
              maxX: origin.x + w - 1,
              maxY: origin.y + h - 1
            }
          )
          return
        }
        case 'dither': {
          drawCommands++
          signatureParts.push('dither')
          const origin = tryStaticCoord(node.x, node.y, node.isCenter, node.isRelativeX, node.isRelativeY, node.anchorName)
          const width = evalStaticScalar(node.width)
          const height = evalStaticScalar(node.height)
          if (!origin || width === null || height === null) return
          const w = Math.trunc(width)
          const h = Math.trunc(height)
          if (w <= 0 || h <= 0) return
          bbox = mergeBoxes(
            bbox,
            {
              minX: origin.x,
              minY: origin.y,
              maxX: origin.x + w - 1,
              maxY: origin.y + h - 1
            }
          )
          return
        }
        case 'line':
        case 'oline': {
          drawCommands++
          signatureParts.push(node.kind)
          const p1 = tryStaticCoord(node.x1, node.y1, node.isCenter1, node.isRelativeX1, node.isRelativeY1, node.anchorName1)
          const p2 = tryStaticCoord(node.x2, node.y2, node.isCenter2, node.isRelativeX2, node.isRelativeY2, node.anchorName2)
          if (!p1 || !p2) return
          bbox = mergeBoxes(
            bbox,
            {
              minX: Math.min(p1.x, p2.x),
              minY: Math.min(p1.y, p2.y),
              maxX: Math.max(p1.x, p2.x),
              maxY: Math.max(p1.y, p2.y)
            }
          )
          return
        }
        case 'circle':
        case 'arc':
        case 'ocirc':
        case 'glow': {
          drawCommands++
          signatureParts.push(node.kind)
          const center = tryStaticCoord(node.cx, node.cy, node.isCenter, node.isRelativeX, node.isRelativeY, node.anchorName)
          const radius = evalStaticScalar(node.radius)
          if (!center || radius === null) return
          const r = Math.trunc(radius)
          if (r < 0) return
          bbox = mergeBoxes(
            bbox,
            {
              minX: center.x - r,
              minY: center.y - r,
              maxX: center.x + r,
              maxY: center.y + r
            }
          )
          return
        }
        case 'ellipse':
        case 'oellipse': {
          drawCommands++
          signatureParts.push(node.kind)
          const center = tryStaticCoord(node.cx, node.cy, node.isCenter, node.isRelativeX, node.isRelativeY, node.anchorName)
          const rx = evalStaticScalar(node.rx)
          const ry = evalStaticScalar(node.ry)
          if (!center || rx === null || ry === null) return
          const resolvedRx = Math.trunc(rx)
          const resolvedRy = Math.trunc(ry)
          if (resolvedRx < 0 || resolvedRy < 0) return
          bbox = mergeBoxes(
            bbox,
            {
              minX: center.x - resolvedRx,
              minY: center.y - resolvedRy,
              maxX: center.x + resolvedRx,
              maxY: center.y + resolvedRy
            }
          )
          return
        }
        case 'polygon':
        case 'opoly': {
          drawCommands++
          signatureParts.push(`${node.kind}:${node.points.length}`)
          let nodeBox: BoundingBox | null = null
          for (const point of node.points) {
            const staticPoint = tryStaticPoint(point)
            if (!staticPoint) {
              nodeBox = null
              break
            }
            nodeBox = mergeBoxes(nodeBox, pointBox(staticPoint.x, staticPoint.y))
          }
          bbox = mergeBoxes(bbox, nodeBox)
          return
        }
        case 'stamp': {
          drawCommands++
          signatureParts.push(`stamp:${node.points.length}`)
          for (const point of node.points) {
            const staticPoint = tryStaticPoint(point)
            if (!staticPoint) continue
            bbox = mergeBoxes(bbox, pointBox(staticPoint.x, staticPoint.y))
          }
          return
        }
        case 'tile':
        case 'scatter': {
          drawCommands++
          signatureParts.push(node.kind)
          const origin = tryStaticCoord(node.x, node.y, node.isCenter, node.isRelativeX, node.isRelativeY, node.anchorName)
          const width = evalStaticScalar(node.width)
          const height = evalStaticScalar(node.height)
          if (!origin || width === null || height === null) return
          const w = Math.trunc(width)
          const h = Math.trunc(height)
          if (w <= 0 || h <= 0) return
          bbox = mergeBoxes(
            bbox,
            {
              minX: origin.x,
              minY: origin.y,
              maxX: origin.x + w - 1,
              maxY: origin.y + h - 1
            }
          )
          return
        }
        case 'map':
          drawCommands++
          signatureParts.push('map')
          return
        case 'emit': {
          drawCommands++
          hasEmit = true
          signatureParts.push('emit')
          const origin = tryStaticCoord(node.x, node.y, node.isCenter, node.isRelativeX, node.isRelativeY, node.anchorName)
          const spreadWidth = evalStaticScalar(node.spreadWidth)
          const spreadHeight = evalStaticScalar(node.spreadHeight)
          if (!origin || spreadWidth === null || spreadHeight === null) return
          const halfW = Math.max(0, Math.floor(Math.trunc(spreadWidth) / 2))
          const halfH = Math.max(0, Math.floor(Math.trunc(spreadHeight) / 2))
          bbox = mergeBoxes(
            bbox,
            {
              minX: origin.x - halfW,
              minY: origin.y - halfH,
              maxX: origin.x + halfW,
              maxY: origin.y + halfH
            }
          )
          return
        }
        case 'clear':
          drawCommands++
          signatureParts.push('clear')
          return
        case 'text':
          drawCommands++
          signatureParts.push(`text:${node.value.length}`)
          return
        default:
          signatureParts.push(node.kind)
          return
      }
    }

    for (const stmt of body) {
      visitFrameNode(stmt)
    }

    return {
      drawCommands,
      singlePixelCommands,
      hasEmit,
      signature: signatureParts.join('|'),
      bbox
    }
  }

  const visitNode = (node: ASTNode, inFrame: boolean): void => {
    switch (node.kind) {
      case 'group':
        groupDefinitions.push({ name: node.name, line: node.pos.line, column: node.pos.column })
        for (const stmt of node.body) {
          visitNode(stmt, inFrame)
        }
        return
      case 'bitmap':
        bitmapDefinitions.push({ name: node.name, line: node.pos.line, column: node.pos.column })
        return
      case 'tileset':
        {
          const targets = new Set<string>()
          for (const entry of node.entries) {
            if (entry.symbol.length === 0 || entry.symbol === '.') continue
            targets.add(entry.target)
          }
          tilesetDefinitions.push({
            name: node.name,
            line: node.pos.line,
            column: node.pos.column,
            targets: Array.from(targets)
          })
        }
        return
      case 'tilemap':
        tilemapDefinitions.push({
          name: node.name,
          line: node.pos.line,
          column: node.pos.column,
          tilesetName: node.tilesetName
        })
        return
      case 'font':
        return
      case 'anchor':
        anchorDefinitions.push({ name: node.name, line: node.pos.line, column: node.pos.column })
        return
      case 'letpt':
        anchorDefinitions.push({ name: node.name, line: node.pos.line, column: node.pos.column })
        markPointAnchorUsage(node.point)
        return
      case 'defpt':
        anchorDefinitions.push({ name: node.name, line: node.pos.line, column: node.pos.column })
        markPointAnchorUsage(node.point)
        return
      case 'stamp':
        usedStampLikeTargets.add(node.name)
        for (const point of node.points) {
          markPointAnchorUsage(point)
        }
        return
      case 'tile':
        usedStampLikeTargets.add(node.name)
        if (node.anchorName) {
          usedAnchors.add(node.anchorName)
        }
        return
      case 'scatter':
        usedStampLikeTargets.add(node.name)
        if (node.anchorName) {
          usedAnchors.add(node.anchorName)
        }
        return
      case 'emit':
        usedStampLikeTargets.add(node.name)
        if (node.anchorName) {
          usedAnchors.add(node.anchorName)
        }
        return
      case 'map':
        usedTilemaps.add(node.name)
        if (node.anchorName) {
          usedAnchors.add(node.anchorName)
        }
        return
      case 'cursor':
        markPointAnchorUsage(node.point)
        return
      case 'pixel':
      case 'polygon':
      case 'opoly':
        for (const point of node.points) {
          markPointAnchorUsage(point)
        }
        return
      case 'fill':
        if (inFrame) {
          addWarning(
            'W004',
            'fill inside frame can overwrite the preamble unexpectedly.',
            node.pos.line,
            node.pos.column,
            'Use a bounded rect for frame-local updates when possible.'
          )
        }
        for (const point of node.points) {
          markPointAnchorUsage(point)
        }
        return
      case 'clear':
        return
      case 'rect':
      case 'circle':
      case 'arc':
      case 'orect':
      case 'ocirc':
      case 'glow':
      case 'ellipse':
      case 'oellipse':
      case 'dither':
      case 'text':
        if (node.anchorName) {
          usedAnchors.add(node.anchorName)
        }
        return
      case 'line':
      case 'oline':
        if (node.anchorName1) {
          usedAnchors.add(node.anchorName1)
        }
        if (node.anchorName2) {
          usedAnchors.add(node.anchorName2)
        }
        return
      case 'frame':
        frameNodes.push(node)
        for (const stmt of node.body) {
          visitNode(stmt, true)
        }
        return
      case 'repeat':
        {
          const staticCount = evalStaticScalar(node.count)
          if (staticCount !== null && Math.trunc(staticCount) <= 0) {
            addWarning(
              'W011',
              'repeat count is non-positive; loop body will not run.',
              node.pos.line,
              node.pos.column,
              'Use a positive count or remove the loop.'
            )
          }
        }
        for (const stmt of node.body) {
          visitNode(stmt, inFrame)
        }
        return
      default:
        return
    }
  }

  for (const stmt of program.statements) {
    visitNode(stmt, false)
  }

  const tilesetByName = new Map<string, { targets: Set<string> }>()
  for (const def of tilesetDefinitions) {
    tilesetByName.set(def.name, { targets: new Set(def.targets) })
  }

  const tilemapByName = new Map<string, { tilesetName: string }>()
  for (const def of tilemapDefinitions) {
    tilemapByName.set(def.name, { tilesetName: def.tilesetName })
  }

  for (const tilemapName of usedTilemaps) {
    const tilemap = tilemapByName.get(tilemapName)
    if (!tilemap) continue
    const tileset = tilesetByName.get(tilemap.tilesetName)
    if (!tileset) continue
    for (const target of tileset.targets) {
      usedStampLikeTargets.add(target)
    }
  }

  const bitmapDefinitionNames = new Set(bitmapDefinitions.map((def) => def.name))
  const groupDefinitionNames = new Set(groupDefinitions.map((def) => def.name))
  for (const targetName of usedStampLikeTargets) {
    if (bitmapDefinitionNames.has(targetName)) {
      usedBitmapTargets.add(targetName)
    } else if (groupDefinitionNames.has(targetName)) {
      usedGroupTargets.add(targetName)
    }
  }

  const dedupeDefinitionsBySource = (
    definitions: Array<{ name: string; line: number; column: number }>
  ): Array<{ name: string; line: number; column: number }> => {
    const seen = new Set<string>()
    const unique: Array<{ name: string; line: number; column: number }> = []
    for (const def of definitions) {
      const key = `${def.name}@${def.line}:${def.column}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(def)
    }
    return unique
  }

  const uniqueGroupDefinitions = dedupeDefinitionsBySource(groupDefinitions)
  const uniqueBitmapDefinitions = dedupeDefinitionsBySource(bitmapDefinitions)
  const uniqueAnchorDefinitions = dedupeDefinitionsBySource(anchorDefinitions)

  for (const def of uniqueGroupDefinitions) {
    if (!usedGroupTargets.has(def.name)) {
      addWarning(
        'W001',
        `Group "${def.name}" is defined but never used.`,
        def.line,
        def.column,
        'Remove the group or add a stamp/tile/map call.'
      )
    }
  }

  for (const def of uniqueBitmapDefinitions) {
    if (!usedBitmapTargets.has(def.name)) {
      addWarning(
        'W002',
        `Bitmap "${def.name}" is defined but never used.`,
        def.line,
        def.column,
        'Remove the bitmap or add a use site (stamp/tile/map).'
      )
    }
  }

  for (const def of uniqueAnchorDefinitions) {
    if (!usedAnchors.has(def.name)) {
      addWarning(
        'W003',
        `Anchor "${def.name}" is defined but never used.`,
        def.line,
        def.column,
        'Use the anchor in draw commands or remove it.'
      )
    }
  }

  const warnDuplicateDefinitions = (
    definitions: Array<{ name: string; line: number; column: number }>,
    code: WarningCode,
    kindLabel: string,
    hint: string
  ): void => {
    const seen = new Set<string>()
    for (const def of definitions) {
      if (!seen.has(def.name)) {
        seen.add(def.name)
        continue
      }
      addWarning(
        code,
        `${kindLabel} "${def.name}" is redefined; later definition overrides earlier one.`,
        def.line,
        def.column,
        hint
      )
    }
  }

  warnDuplicateDefinitions(
    uniqueGroupDefinitions,
    'W006',
    'Group',
    'Rename one group or keep only the intended definition.'
  )
  warnDuplicateDefinitions(
    uniqueBitmapDefinitions,
    'W007',
    'Bitmap',
    'Rename one bitmap or remove duplicate definitions.'
  )
  warnDuplicateDefinitions(
    uniqueAnchorDefinitions,
    'W008',
    'Anchor',
    'Use unique anchor names or keep one canonical definition.'
  )

  if (frameNodes.length > 0) {
    const sortedFrameNumbers = frameNodes
      .map((frame) => frame.frameNumber)
      .sort((a, b) => a - b)

    let isSparse = sortedFrameNumbers[0] !== 0
    if (!isSparse) {
      for (let i = 1; i < sortedFrameNumbers.length; i++) {
        if (sortedFrameNumbers[i] !== sortedFrameNumbers[i - 1] + 1) {
          isSparse = true
          break
        }
      }
    }

    if (isSparse) {
      const firstFrame = frameNodes.reduce((first, current) => {
        if (current.pos.line < first.pos.line) return current
        if (current.pos.line === first.pos.line && current.pos.column < first.pos.column) return current
        return first
      }, frameNodes[0])

      addWarning(
        'W005',
        'Frame numbers are sparse or do not start at 0.',
        firstFrame.pos.line,
        firstFrame.pos.column,
        'Use sequential frame numbers (0..N) unless sparse numbering is intentional.'
      )
    }

    const seenFrameNumbers = new Set<number>()
    for (const frame of frameNodes) {
      if (seenFrameNumbers.has(frame.frameNumber)) {
        addWarning(
          'W009',
          `Frame number ${frame.frameNumber} is defined more than once.`,
          frame.pos.line,
          frame.pos.column,
          'Use unique sequential frame numbers (0..N).'
        )
      } else {
        seenFrameNumbers.add(frame.frameNumber)
      }

      if (frame.body.length === 0) {
        addWarning(
          'W010',
          `Frame ${frame.frameNumber} has no drawing commands.`,
          frame.pos.line,
          frame.pos.column,
          'Add frame-local changes or remove the empty frame.'
        )
      }
    }

    if (frameNodes.length >= 3) {
      const frameMetrics = frameNodes.map((frame) => ({
        frame,
        metrics: analyzeFrameBody(frame.body)
      }))
      const totalDrawCommands = frameMetrics.reduce((sum, entry) => sum + entry.metrics.drawCommands, 0)
      const totalSinglePixels = frameMetrics.reduce((sum, entry) => sum + entry.metrics.singlePixelCommands, 0)
      const hasAnyEmit = frameMetrics.some((entry) => entry.metrics.hasEmit)

      const hasUniformStaticBbox =
        frameNodes.length >= 4 &&
        frameMetrics.every((entry) => entry.metrics.bbox !== null) &&
        (() => {
          const first = frameMetrics[0].metrics.bbox!
          return frameMetrics.every((entry) => {
            const box = entry.metrics.bbox!
            return box.minX === first.minX &&
              box.minY === first.minY &&
              box.maxX === first.maxX &&
              box.maxY === first.maxY
          })
        })()

      if (hasUniformStaticBbox) {
        addWarning(
          'W014',
          'Animation frames show no meaningful bounding-box movement.',
          frameMetrics[0].frame.pos.line,
          frameMetrics[0].frame.pos.column,
          'Use $frame/$frameNumber with lerp/ease_in_out (or emit time) to drive movement.'
        )
      }

      if (frameNodes.length >= 4 && totalDrawCommands >= 10 && !hasAnyEmit) {
        let sameAdjacentSignatures = 0
        for (let i = 1; i < frameMetrics.length; i++) {
          if (frameMetrics[i - 1].metrics.signature === frameMetrics[i].metrics.signature) {
            sameAdjacentSignatures++
          }
        }
        const adjacentSimilarity = sameAdjacentSignatures / (frameMetrics.length - 1)
        const singlePixelRatio = totalSinglePixels / Math.max(1, totalDrawCommands)

        if (adjacentSimilarity >= 0.6 && singlePixelRatio >= 0.4) {
          addWarning(
            'W015',
            'Animation frames are highly repetitive with sparse manual edits.',
            frameMetrics[0].frame.pos.line,
            frameMetrics[0].frame.pos.column,
            'Use built-in frame vars, repeat/groups, and emit to reduce frame-by-frame duplication.'
          )
        }
      }

      if (!hasAnyEmit) {
        const sparkLikeFrames = frameMetrics
          .filter((entry) => entry.metrics.singlePixelCommands >= 3)
          .length
        if (sparkLikeFrames >= 3 && totalSinglePixels >= 24) {
          addWarning(
            'W016',
            'Animation uses many manual single-pixel spark edits across frames.',
            frameMetrics[0].frame.pos.line,
            frameMetrics[0].frame.pos.column,
            'Use emit for spark/projectile particle patterns.'
          )
        }
      }
    }
  }

  return warnings
}
