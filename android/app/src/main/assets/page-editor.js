// Edits a job's written page in place for managers in the crew app. The iOS
// (ServiceFlow/Resources) and Android (app/src/main/assets) apps load the same
// copy of this file. Lists are rebuilt the way the web admin's editor does it
// (web/src/lib/editor-lists.ts): execCommand nests lists inside paragraphs.
(function () {
  if (window.serviceFlowPage) return;
  var root = document.body;

  function send(message) {
    var text = JSON.stringify(message);
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.page) {
      window.webkit.messageHandlers.page.postMessage(text);
    } else if (window.ServiceFlowPage) {
      window.ServiceFlowPage.post(text);
    }
  }

  function closest(node, selector) {
    var element = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    return element ? element.closest(selector) : null;
  }

  // ---- lists (ported from web/src/lib/editor-lists.ts) ----

  function kindOf(list) {
    if (list.tagName === "OL") return "numbers";
    if (list.tagName === "UL") return list.hasAttribute("data-checklist") ? "checklist" : "bullets";
    return null;
  }

  function makeList(kind) {
    var list = document.createElement(kind === "numbers" ? "ol" : "ul");
    if (kind === "checklist") list.setAttribute("data-checklist", "true");
    return list;
  }

  function topLevel(node) {
    var current = node;
    while (current && current.parentNode !== root) current = current.parentNode;
    return current && current.nodeType === Node.ELEMENT_NODE ? current : null;
  }

  function moveChildren(from, to) {
    while (from.firstChild) to.appendChild(from.firstChild);
    if (!to.firstChild) to.appendChild(document.createElement("br"));
  }

  function prepareItem(item, kind) {
    if (kind === "checklist") {
      if (!item.hasAttribute("data-checked")) item.setAttribute("data-checked", "false");
    } else {
      item.removeAttribute("data-checked");
    }
  }

  function selectedItems(range) {
    var first = topLevel(range.startContainer);
    var last = topLevel(range.endContainer) || first;
    if (!first || !last) return [];
    var items = [];
    for (var node = first; node; node = node.nextElementSibling) {
      if (node.tagName === "UL" || node.tagName === "OL") {
        var lis = Array.prototype.filter.call(node.children, function (child) { return child.tagName === "LI"; });
        var inRange = lis.filter(function (li) { return range.intersectsNode(li); });
        items.push.apply(items, inRange.length ? inRange : lis);
      } else if (["TABLE", "HR", "IMG"].indexOf(node.tagName) < 0) {
        items.push(node);
      }
      if (node === last) break;
    }
    return items;
  }

  function nodeLength(node) {
    return node.nodeType === Node.TEXT_NODE ? (node.textContent || "").length : node.childNodes.length;
  }

  function toggleList(kind) {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return false;
    var range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return false;

    Array.prototype.slice.call(root.childNodes).forEach(function (child) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
        var paragraph = document.createElement("p");
        root.insertBefore(paragraph, child);
        paragraph.appendChild(child);
      }
    });

    var caret = { start: range.startContainer, startOffset: range.startOffset, end: range.endContainer, endOffset: range.endOffset };
    var items = selectedItems(range);
    if (!items.length) return false;

    var allInKind = items.every(function (item) {
      return item.tagName === "LI" && item.parentElement && kindOf(item.parentElement) === kind;
    });
    var lists;
    if (allInKind) {
      lists = items.map(function (item) { return item.parentElement; }).filter(function (list, index, all) { return all.indexOf(list) === index; });
      lists.forEach(function (list) {
        var fragment = document.createDocumentFragment();
        var group = null;
        Array.prototype.slice.call(list.children).forEach(function (li) {
          if (items.indexOf(li) >= 0) {
            group = null;
            var paragraph = document.createElement("p");
            moveChildren(li, paragraph);
            fragment.appendChild(paragraph);
          } else {
            if (!group) {
              group = list.cloneNode(false);
              fragment.appendChild(group);
            }
            group.appendChild(li);
          }
        });
        list.replaceWith(fragment);
      });
    } else {
      lists = items.filter(function (item) { return item.tagName === "LI"; })
        .map(function (item) { return item.parentElement; })
        .filter(function (list, index, all) { return all.indexOf(list) === index; });
      var replacement = makeList(kind);
      var onlyOneWholeList = lists.length === 1 &&
        items.every(function (item) { return item.parentElement === lists[0]; }) &&
        items.length === lists[0].children.length;
      if (onlyOneWholeList) {
        Array.prototype.slice.call(lists[0].children).forEach(function (li) {
          prepareItem(li, kind);
          replacement.appendChild(li);
        });
        lists[0].replaceWith(replacement);
      } else {
        root.insertBefore(replacement, topLevel(items[0]));
        items.forEach(function (item) {
          if (item.tagName === "LI") {
            prepareItem(item, kind);
            replacement.appendChild(item);
          } else {
            var li = document.createElement("li");
            moveChildren(item, li);
            prepareItem(li, kind);
            replacement.appendChild(li);
            item.remove();
          }
        });
        lists.forEach(function (list) { if (!list.children.length) list.remove(); });
      }
    }

    var restored = document.createRange();
    try {
      if (!caret.start.isConnected || !caret.end.isConnected) throw new Error("moved");
      restored.setStart(caret.start, Math.min(caret.startOffset, nodeLength(caret.start)));
      restored.setEnd(caret.end, Math.min(caret.endOffset, nodeLength(caret.end)));
    } catch (error) {
      restored.selectNodeContents(root);
      restored.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(restored);
    return true;
  }

  // ---- state and changes ----

  function state() {
    var selection = window.getSelection();
    var none = { kind: "state", block: "p", bold: false, italic: false, underline: false, bullets: false, numbers: false, checklist: false };
    if (!selection || !selection.rangeCount || !root.contains(selection.anchorNode)) return none;
    var range = selection.getRangeAt(0);
    var block = "p";
    for (var node = range.startContainer; node && node !== root; node = node.parentNode) {
      var name = node.nodeName.toLowerCase();
      if (name === "h1" || name === "h2" || name === "h3") { block = name; break; }
    }
    function active(command) {
      try { return document.queryCommandState(command); } catch (error) { return false; }
    }
    var list = closest(range.startContainer, "ul,ol");
    return {
      kind: "state",
      block: block,
      bold: active("bold"),
      italic: active("italic"),
      underline: active("underline"),
      bullets: !!(list && list.matches("ul:not([data-checklist])")),
      numbers: !!(list && list.tagName === "OL"),
      checklist: !!(list && list.matches("ul[data-checklist]")),
    };
  }

  var stateQueued = false;
  function reportState() {
    if (stateQueued) return;
    stateQueued = true;
    requestAnimationFrame(function () {
      stateQueued = false;
      send(state());
    });
  }

  function changed() {
    send({ kind: "changed", html: root.innerHTML });
    reportState();
  }

  try {
    document.execCommand("defaultParagraphSeparator", false, "p");
    document.execCommand("styleWithCSS", false, true);
  } catch (error) {}

  root.addEventListener("input", function (event) {
    // A new checklist item starts unchecked.
    if (event.inputType === "insertParagraph") {
      var selection = window.getSelection();
      var item = selection && selection.rangeCount ? closest(selection.getRangeAt(0).startContainer, "li") : null;
      if (item && item.parentElement.matches("ul[data-checklist]")) item.setAttribute("data-checked", "false");
    }
    changed();
  });
  document.addEventListener("selectionchange", reportState);
  // Tapping a checklist item's box ticks it.
  root.addEventListener("click", function (event) {
    var item = event.target.closest ? event.target.closest("li") : null;
    if (!item || !item.parentElement.matches("ul[data-checklist]")) return;
    if (event.clientX - item.getBoundingClientRect().left > 28) return;
    item.setAttribute("data-checked", item.getAttribute("data-checked") === "true" ? "false" : "true");
    changed();
  });

  window.serviceFlowPage = {
    run: function (command, value) {
      if (command === "bullets" || command === "numbers" || command === "checklist") {
        toggleList(command);
      } else {
        document.execCommand(command, false, value);
      }
      changed();
    },
  };
})();
