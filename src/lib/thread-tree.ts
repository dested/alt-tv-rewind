import type { RouterOutputs } from '~/lib/api-types'

type Message = RouterOutputs['threads']['get']['messages'][number]
export type Node = { message: Message; children: Node[] }

// Builds the reply tree from a flat, postedAt-ordered message list. A message
// whose parentId is null or points outside the set is a root; children and
// roots are ordered by postedAt ascending (ISO strings sort chronologically).
export function buildTree(messages: RouterOutputs['threads']['get']['messages']): {
  roots: Node[]
  byId: Map<number, Node>
} {
  const byId = new Map<number, Node>()
  for (const message of messages) {
    byId.set(message.id, { message, children: [] })
  }

  const roots: Node[] = []
  for (const message of messages) {
    const node = byId.get(message.id)
    if (!node) continue
    const parent = message.parentId === null ? undefined : byId.get(message.parentId)
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const byPostedAt = (a: Node, b: Node): number =>
    a.message.postedAt < b.message.postedAt ? -1 : a.message.postedAt > b.message.postedAt ? 1 : 0
  roots.sort(byPostedAt)
  for (const node of byId.values()) node.children.sort(byPostedAt)

  return { roots, byId }
}
