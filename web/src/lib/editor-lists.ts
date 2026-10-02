/**
 * List toggling for the document editor. Chrome's execCommand list commands
 * nest <ul> inside <p> and move the caret, so lists are rebuilt here directly.
 */

export type ListKind = "bullets" | "numbers" | "checklist";

function kindOf(list: Element): ListKind | null {
  if (list.tagName === "OL") return "numbers";
  if (list.tagName === "UL") return list.hasAttribute("data-checklist") ? "checklist" : "bullets";
  return null;
}

function makeList(kind: ListKind): HTMLElement {
  const list = document.createElement(kind === "numbers" ? "ol" : "ul");
  if (kind === "checklist") list.setAttribute("data-checklist", "true");
  return list;
}

function topLevel(root: HTMLElement, node: Node): Element | null {
  let current: Node | null = node;
  while (current && current.parentNode !== root) current = current.parentNode;
  return current && current.nodeType === Node.ELEMENT_NODE ? (current as Element) : null;
}

function moveChildren(from: Element, to: Element) {
  while (from.firstChild) to.appendChild(from.firstChild);
  if (!to.firstChild) to.appendChild(document.createElement("br"));
}

function prepareItem(item: Element, kind: ListKind) {
  if (kind === "checklist") {
    if (!item.hasAttribute("data-checked")) item.setAttribute("data-checked", "false");
  } else {
    item.removeAttribute("data-checked");
  }
}

/** Items (list items or blocks) touched by the range, in document order. */
function selectedItems(root: HTMLElement, range: Range): Element[] {
  const first = topLevel(root, range.startContainer);
  const last = topLevel(root, range.endContainer) ?? first;
  if (!first || !last) return [];
  const items: Element[] = [];
  for (let node: Element | null = first; node; node = node.nextElementSibling) {
    if (node.tagName === "UL" || node.tagName === "OL") {
      const lis = Array.from(node.children).filter((child) => child.tagName === "LI");
      const inRange = lis.filter((li) => range.intersectsNode(li));
      items.push(...(inRange.length ? inRange : lis));
    } else if (!["TABLE", "HR", "IMG"].includes(node.tagName)) {
      items.push(node);
    }
    if (node === last) break;
  }
  return items;
}

export function toggleList(root: HTMLElement, kind: ListKind): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return false;

  // Bare text directly in the editor: wrap it in a paragraph first.
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      const paragraph = document.createElement("p");
      root.insertBefore(paragraph, child);
      paragraph.appendChild(child);
    }
  }

  const caret = {
    start: range.startContainer,
    startOffset: range.startOffset,
    end: range.endContainer,
    endOffset: range.endOffset,
  };
  const items = selectedItems(root, range);
  if (!items.length) return false;

  const allInKind = items.every(
    (item) => item.tagName === "LI" && item.parentElement && kindOf(item.parentElement) === kind,
  );

  if (allInKind) {
    // Turn the selected items back into paragraphs, splitting their lists.
    const lists = Array.from(new Set(items.map((item) => item.parentElement!)));
    for (const list of lists) {
      const fragment = document.createDocumentFragment();
      let group: Element | null = null;
      for (const li of Array.from(list.children)) {
        if (items.includes(li)) {
          group = null;
          const paragraph = document.createElement("p");
          moveChildren(li, paragraph);
          fragment.appendChild(paragraph);
        } else {
          if (!group) {
            group = list.cloneNode(false) as Element;
            fragment.appendChild(group);
          }
          group.appendChild(li);
        }
      }
      list.replaceWith(fragment);
    }
  } else {
    const lists = Array.from(
      new Set(items.filter((item) => item.tagName === "LI").map((item) => item.parentElement!)),
    );
    const onlyOneWholeList =
      lists.length === 1 &&
      items.every((item) => item.parentElement === lists[0]) &&
      items.length === lists[0].children.length;
    if (onlyOneWholeList) {
      // Same items, different list style.
      const list = lists[0];
      const replacement = makeList(kind);
      for (const li of Array.from(list.children)) {
        prepareItem(li, kind);
        replacement.appendChild(li);
      }
      list.replaceWith(replacement);
    } else {
      const replacement = makeList(kind);
      const anchor = topLevel(root, items[0])!;
      root.insertBefore(replacement, anchor);
      for (const item of items) {
        if (item.tagName === "LI") {
          prepareItem(item, kind);
          replacement.appendChild(item);
        } else {
          const li = document.createElement("li");
          moveChildren(item, li);
          prepareItem(li, kind);
          replacement.appendChild(li);
          item.remove();
        }
      }
      for (const list of lists) if (!list.children.length) list.remove();
    }
  }

  // Put the caret back where it was (text nodes moved, they were not recreated).
  const restored = document.createRange();
  try {
    if (!caret.start.isConnected || !caret.end.isConnected) throw new Error("moved");
    restored.setStart(caret.start, Math.min(caret.startOffset, nodeLength(caret.start)));
    restored.setEnd(caret.end, Math.min(caret.endOffset, nodeLength(caret.end)));
  } catch {
    restored.selectNodeContents(root);
    restored.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(restored);
  return true;
}

function nodeLength(node: Node): number {
  return node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length;
}
