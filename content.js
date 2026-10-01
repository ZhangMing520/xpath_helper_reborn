/**
 * Copyright 2011 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @author opensource@google.com
 * @license Apache License, Version 2.0.
 */

'use strict';

// Extension namespace.
var xh = xh || {};


////////////////////////////////////////////////////////////////////////////////
// Generic helper functions and constants

xh.bind = function(object, method) {
  return function() {
    return method.apply(object, arguments);
  };
};

xh.elementsShareFamily = function(primaryEl, siblingEl) {
  // getAttribute('class'), not .className: on SVG elements className is an
  // SVGAnimatedString, so string comparison would always fail.
  var primaryClass = primaryEl.getAttribute('class');
  var siblingClass = siblingEl.getAttribute('class');
  if (primaryEl.tagName === siblingEl.tagName &&
      (!primaryClass || primaryClass === siblingClass) &&
      (!primaryEl.id || primaryEl.id === siblingEl.id)) {
    return true;
  }
  return false;
};

xh.getElementIndex = function(el) {
  var className = el.className;
  var id = el.id;

  var index = 1;  // XPath is one-indexed
  var sib;
  for (sib = el.previousSibling; sib; sib = sib.previousSibling) {
    if (sib.nodeType === Node.ELEMENT_NODE && xh.elementsShareFamily(el, sib)) {
      index++;
    }
  }
  if (index > 1) {
    return index;
  }
  for (sib = el.nextSibling; sib; sib = sib.nextSibling) {
    if (sib.nodeType === Node.ELEMENT_NODE && xh.elementsShareFamily(el, sib)) {
      return 1;
    }
  }
  return 0;
};

// Builds the XPath for an element. `step` is the trailing step that selects a
// non-element node (see nodeStep); given one, the <img> convenience of ending at
// /@src is skipped so the caller's step is the only one.
xh.makeQueryForElement = function(el, step) {
  // Quotes in an id/class must be escaped, or the resulting XPath is invalid
  // (e.g. id="a'b" would produce the broken predicate [@id='a'b']).
  var xpLit = function(value) {
    if (value.indexOf("'") === -1) {
      return "'" + value + "'";
    }
    if (value.indexOf('"') === -1) {
      return '"' + value + '"';
    }
    return "concat('" + value.replace(/'/g, "',\"'\",'") + "')";
  };
  var query = '';
  for (; el && el.nodeType === Node.ELEMENT_NODE; el = el.parentNode) {
    var component = el.tagName.toLowerCase();
    var index = xh.getElementIndex(el);
    if (el.id) {
      component += '[@id=' + xpLit(el.id) + ']';
    } else if (el.getAttribute('class')) {
      component += '[@class=' + xpLit(el.getAttribute('class')) + ']';
    }
    if (index >= 1) {
      component += '[' + index + ']';
    }
    // If the last tag is an img, the user probably wants img/@src.
    if (query === '' && !step && el.tagName.toLowerCase() === 'img') {
      component += '/@src';
    }
    query = '/' + component + query;
  }
  return query + (step || '');
};

xh.highlightNodes = function(nodes) {
  for (var i = 0, l = nodes.length; i < l; i++) {
    // An XPath can also select text nodes and attributes: they have no
    // classList and nothing to paint, so skip them.
    if (nodes[i].classList) {
      nodes[i].classList.add('xh-highlight');
    }
  }
};

// The one result the bar is pointing at, outlined separately from the
// xh-highlight class that marks every match.
xh.hoveredEl_ = null;
xh.setHoverHighlight = function(el) {
  if (xh.hoveredEl_) {
    xh.hoveredEl_.classList.remove('xh-hover');
  }
  xh.hoveredEl_ = el;
  if (xh.hoveredEl_) {
    xh.hoveredEl_.classList.add('xh-hover');
  }
};

// Takes off both marks this extension paints. They always come off together,
// and always before evaluating: a query testing @class would otherwise stop
// matching the elements we had marked.
xh.clearHighlights = function() {
  // Static list, then mutate: clearing through the live HTMLCollection this
  // used to use makes the engine re-collect on every write, which is quadratic
  // - with 10k matches each keystroke cleared for ~2s and froze the page.
  // classList also keeps working on SVG, whose className is not a string.
  var els = document.querySelectorAll('.xh-highlight');
  for (var i = 0, l = els.length; i < l; i++) {
    els[i].classList.remove('xh-highlight');
  }
  xh.setHoverHighlight(null);
};

// The element to outline for a node the bar points at. Text, attribute and
// comment nodes have no box of their own, so they fall back to the element
// containing them.
xh.outlineTarget = function(node) {
  if (!node) {
    return null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return node;
  }
  if (node.nodeType === Node.ATTRIBUTE_NODE) {
    return node.ownerElement;
  }
  if (node.nodeType === Node.DOCUMENT_NODE) {
    return document.documentElement;
  }
  return node.parentElement;
};

// The extra step that selects a non-element node from the element containing
// it, so a picked text()/attribute result keeps selecting that exact node
// rather than its parent.
xh.nodeStep = function(node) {
  var kind = xh.nodeKind(node);
  if (kind === 'text' || kind === 'cdata') {
    return '/text()';
  }
  return kind === 'attribute' ? '/@' + node.nodeName : '';
};

// The kind of a node an XPath can select, as a short token that is both the key
// of the per-kind tally and the thing the bar labels a result with.
xh.nodeKind = function(node) {
  switch (node.nodeType) {
    case Node.ELEMENT_NODE:
      return 'element';
    case Node.ATTRIBUTE_NODE:
      return 'attribute';
    case Node.TEXT_NODE:
      return 'text';
    case Node.CDATA_SECTION_NODE:
      return 'cdata';
    case Node.COMMENT_NODE:
      return 'comment';
    case Node.DOCUMENT_NODE:
      return 'document';
    default:
      return 'node';
  }
};

// A results list is capped so that a query matching thousands of nodes cannot
// build thousands of rows or a huge message; the plain text view still gets
// every match.
var MAX_RESULT_ROWS = 500;
var MAX_ROW_TEXT = 300;

// How each kind is spelled out in the results. The bar labels a non-element
// result with it and the count summary builds from it, so both sides share one
// vocabulary. Loaded once from the locale pack (see _locales); the English
// token is the fallback if a translation is missing.
var KIND_LABELS = {};
['element', 'attribute', 'text', 'cdata', 'comment', 'document', 'node',
 'boolean', 'number', 'string'].forEach(function(kind) {
  KIND_LABELS[kind] = chrome.i18n.getMessage('kind_' + kind) || kind;
});

// Chinese has no plural and wraps the count in 个; English just adds an 's'.
// Drive this off the locale that was actually resolved (a sentinel in the
// message pack), not the browser UI locale - the two can diverge, and a
// browser-language check would wrongly pluralize Chinese labels as "元素s".
var isZh_ = chrome.i18n.getMessage('_locale') === 'zh';

var kindPhrase = function(n, label) {
  return isZh_ ? n + ' 个' + label : n + ' ' + label + (n === 1 ? '' : 's');
};

// '24 elements' when every match is the same kind, or '24: 20 elements, 4 text
// nodes' when it is mixed - worth saying at all because the text of `//x` and
// `//x/text()` is identical. It lives here, next to the kind vocabulary, so the
// bar does not have to keep its own copy of these names.
var countLabel = function(count, counts) {
  var entries = [];
  for (var kind in counts) {
    if (counts.hasOwnProperty(kind)) {
      entries.push(kindPhrase(counts[kind], KIND_LABELS[kind]));
    }
  }
  if (entries.length === 1) {
    return entries[0];
  }
  if (entries.length === 0) {
    return String(count);
  }
  return isZh_
      ? '共 ' + count + ' 个：' + entries.join('，')
      : count + ': ' + entries.join(', ');
};

// A compact identity for one result, shown at the start of its row. Anything
// that is not an element has no identity of its own to show.
xh.describeNode = function(node) {
  var kind = xh.nodeKind(node);
  if (kind === 'element') {
    var tag = node.tagName.toLowerCase();
    if (node.id) {
      return tag + '#' + node.id;
    }
    // getAttribute(), not className: on SVG elements className is not a string.
    var className = node.getAttribute('class');
    return className ? tag + '.' + className.trim().split(/\s+/).join('.') : tag;
  }
  return kind === 'attribute' ? '@' + node.nodeName : KIND_LABELS[kind];
};

// Evaluates the query and highlights the nodes it matched. Returns
// {str, count, label, rows, nodes, message}: `str` is the text of every match,
// newline separated (the plain text view shows it verbatim), `label` names what
// was matched by kind, `rows` describes the first MAX_RESULT_ROWS matches and
// `nodes` mirrors it so the bar can ask for one of them to be outlined.
// Assumes nothing is highlighted already.
xh.evaluateQuery = function(query) {
  var xpathResult = null;
  var str = '';
  var nodeCount = 0;
  var counts = {};
  var rows = [];
  var message = '';
  var nodesToHighlight = [];

  // Tally every match, but describe only the first MAX_RESULT_ROWS of them.
  var record = function(node, kind, text) {
    counts[kind] = (counts[kind] || 0) + 1;
    if (rows.length === MAX_RESULT_ROWS) {
      return;
    }
    rows.push({
      label: xh.describeNode(node),
      text: text.length > MAX_ROW_TEXT ? text.slice(0, MAX_ROW_TEXT) : text
    });
  };

  // Scalars match no node, so they get a row to show but nothing to outline.
  var scalar = function(kind) {
    counts[kind] = 1;
    rows.push({label: KIND_LABELS[kind], text: str});
  };

  try {
    xpathResult = document.evaluate(query, document, null,
                                    XPathResult.ANY_TYPE, null);
  } catch (e) {
    message = chrome.i18n.getMessage('invalidXpath');
  }

  if (!xpathResult) {
    return {str: message, count: 0, label: countLabel(0, counts), rows: rows,
            nodes: [], message: message};
  }

  if (xpathResult.resultType === XPathResult.BOOLEAN_TYPE) {
    str = xpathResult.booleanValue ? '1' : '0';
    nodeCount = 1;
    scalar('boolean');
  } else if (xpathResult.resultType === XPathResult.NUMBER_TYPE) {
    str = xpathResult.numberValue.toString();
    nodeCount = 1;
    scalar('number');
  } else if (xpathResult.resultType === XPathResult.STRING_TYPE) {
    str = xpathResult.stringValue;
    nodeCount = 1;
    scalar('string');
  } else if (xpathResult.resultType ===
             XPathResult.UNORDERED_NODE_ITERATOR_TYPE ||
             xpathResult.resultType ===
             XPathResult.ORDERED_NODE_ITERATOR_TYPE) {
    for (var it = xpathResult.iterateNext(); it;
         it = xpathResult.iterateNext()) {
      // Read the text once: it is not free for an element (it walks the subtree)
      // and both the flat string and the row need it.
      var text = it.textContent || '';
      nodesToHighlight.push(it);
      // Cap the flat string at MAX_RESULT_ROWS matches so a query matching
      // tens of thousands of nodes cannot build a huge string on every
      // keystroke; the row list is capped the same way.
      if (nodeCount < MAX_RESULT_ROWS) {
        if (str) {
          str += '\n';
        }
        str += text;
      }
      nodeCount++;
      record(it, xh.nodeKind(it), text);
    }
    if (nodeCount === 0) {
      str = '';
    }
  } else {
    // Since we pass XPathResult.ANY_TYPE to document.evaluate(), we should
    // never get back a result type not handled above.
    message = chrome.i18n.getMessage('internalError');
    str = message;
  }

  xh.highlightNodes(nodesToHighlight);
  var label = countLabel(nodeCount, counts);
  if (nodeCount > rows.length) {
    label += chrome.i18n.getMessage('showingFirst', String(rows.length));
  }
  return {str: str, count: nodeCount, label: label, rows: rows,
          nodes: nodesToHighlight.slice(0, rows.length), message: message};
};


////////////////////////////////////////////////////////////////////////////////
// xh.Bar class definition

xh.Bar = function() {
  this.boundShowBar_ = xh.bind(this, this.showBar_);
  this.boundHandleRequest_ = xh.bind(this, this.handleRequest_);
  this.boundMouseMove_ = xh.bind(this, this.mouseMove_);
  this.boundKeyDown_ = xh.bind(this, this.keyDown_);

  chrome.runtime.onMessage.addListener(this.boundHandleRequest_);

  this.barFrame_ = document.createElement('iframe');
  this.barFrame_.src = chrome.runtime.getURL('bar.html');
  this.barFrame_.id = 'xh-bar';
  this.barFrame_.className = 'top';
  this.barFrame_.style.height = '0';

  // The iframe has to be in the DOM for its document to load and report its
  // height back to us (see handleRequest_); until then it stays hidden and
  // zero-sized.
  this.barFrame_.style.visibility = 'hidden';
  document.body.appendChild(this.barFrame_);

  document.addEventListener('keydown', this.boundKeyDown_);
};

xh.Bar.prototype.active_ = false;
xh.Bar.prototype.barFrame_ = null;
xh.Bar.prototype.barHeightInPx_ = 0;
xh.Bar.prototype.currEl_ = null;
xh.Bar.prototype.query_ = '';
xh.Bar.prototype.showTimer_ = 0;
xh.Bar.prototype.evalId_ = 0;
xh.Bar.prototype.lastEvalNodes_ = null;
xh.Bar.prototype.boundHandleRequest_ = null;
xh.Bar.prototype.boundMouseMove_ = null;
xh.Bar.prototype.boundKeyDown_ = null;

xh.Bar.prototype.updateQueryAndBar_ = function(el, step) {
  xh.clearHighlights();
  this.query_ = el ? xh.makeQueryForElement(el, step) : '';
  this.updateBar_(true);
};

xh.Bar.prototype.updateBar_ = function(update_query) {
  var result = this.query_ ? xh.evaluateQuery(this.query_) :
      {str: '', count: 0, label: '0', rows: [], nodes: [], message: ''};
  // `nodes` stays here: a Node cannot be sent through sendMessage.
  this.lastEvalNodes_ = result.nodes;
  this.evalId_++;
  var request = {
    'type': 'update',
    'query': update_query ? this.query_ : null,
    'evalId': this.evalId_,
    'str': result.str,
    'count': result.count,
    'label': result.label,
    'rows': result.rows,
    'message': result.message
  };
  chrome.runtime.sendMessage(request).catch(function() {});
};

xh.Bar.prototype.showBar_ = function() {
  this.barFrame_.style.height = this.barHeightInPx_ + 'px';
  document.addEventListener('mousemove', this.boundMouseMove_);
  this.updateBar_(true);
};

xh.Bar.prototype.hideBar_ = function() {
  // Note: It's important to set this.active_ to false here rather than in
  // keyDown_() because hideBar_() could be called via handleRequest_().
  this.active_ = false;
  xh.clearHighlights();
  // Nothing can be hovered or picked while hidden, so do not keep up to
  // MAX_RESULT_ROWS page nodes pinned.
  this.lastEvalNodes_ = null;
  document.removeEventListener('mousemove', this.boundMouseMove_);
  this.barFrame_.style.height = '0';
};

xh.Bar.prototype.dispose = function() {
  if (this.showTimer_) {
    window.clearTimeout(this.showTimer_);
    this.showTimer_ = 0;
  }
  this.hideBar_();
  document.removeEventListener('keydown', this.boundKeyDown_);
  chrome.runtime.onMessage.removeListener(this.boundHandleRequest_);
  // remove() tolerates a frame the page has already detached.
  this.barFrame_.remove();
};

xh.Bar.prototype.toggleBar_ = function() {
  if (!this.active_) {
    this.active_ = true;
    if (!this.barFrame_.parentNode) {
      // First bar request on this page. Add bar back to DOM.
      document.body.appendChild(this.barFrame_);
      // Use setTimeout so that the transition is visible.
      this.showTimer_ = window.setTimeout(this.boundShowBar_, 0);
    } else {
      this.showBar_();
    }
  } else {
    this.hideBar_();
    // Focus may sit inside the now-collapsed bar iframe; hand it back so the
    // top document keeps receiving key events.
    window.focus();
  }
};

// The node a message from the bar refers to, or null when it names an
// evaluation we have already replaced, or the bar has been hidden since.
xh.Bar.prototype.requestedNode_ = function(request) {
  if (!this.lastEvalNodes_ || request['evalId'] !== this.evalId_) {
    return null;
  }
  var index = request['index'];
  return index == null ? null : (this.lastEvalNodes_[index] || null);
};

xh.Bar.prototype.handleRequest_ = function(request, sender, callback) {
  if (request['type'] === 'height' && this.barHeightInPx_ === 0) {
    this.barHeightInPx_ = request['height'];
    this.barFrame_.style.visibility = 'visible';
    if (this.active_) {
      // Toggled on before this height arrived, so size the bar the user is
      // already waiting for rather than detaching it.
      this.barFrame_.style.height = this.barHeightInPx_ + 'px';
    } else {
      // remove() is a no-op if the page already dropped the frame, where
      // removeChild() would throw and reject the sender's sendMessage.
      this.barFrame_.remove();
    }
  } else if (request['type'] === 'resizeStart') {
    // Stretch the iframe over the viewport for the duration of a height drag;
    // bar.js explains why that is necessary. #xh-bar transitions its height
    // (see content.css), which would animate both the stretch and the
    // snap-back on release into a visible slide, so switch the transition off
    // for the drag. Inline !important is required because content.css sets it
    // with !important.
    this.barFrame_.style.setProperty('transition', 'none', 'important');
    this.barFrame_.style.height = window.innerHeight + 'px';
  } else if (request['type'] === 'resizeEnd') {
    var height = request['height'];
    if (height > 0) {
      // Keep the bar inside the viewport, or its divider goes off screen.
      this.barHeightInPx_ = Math.min(height, window.innerHeight);
      this.barFrame_.style.height = this.barHeightInPx_ + 'px';
    }
    // Put the transition back once that height has been applied, so it cannot
    // animate it; show/hide and relocate keep their animation.
    var barFrame = this.barFrame_;
    window.requestAnimationFrame(function() {
      barFrame.style.removeProperty('transition');
    });
  } else if (request['type'] === 'evaluate') {
    xh.clearHighlights();
    this.query_ = request['query'];
    this.updateBar_(false);
  } else if (request['type'] === 'hoverResult') {
    xh.setHoverHighlight(xh.outlineTarget(this.requestedNode_(request)));
  } else if (request['type'] === 'pickResult') {
    // The user picked a result: make its node the query, which is exactly what
    // shift-hovering that node does.
    var node = this.requestedNode_(request);
    var picked = xh.outlineTarget(node);
    if (picked) {
      this.updateQueryAndBar_(picked, xh.nodeStep(node));
    }
  } else if (request['type'] === 'relocateBar') {
    // Move iframe to a different part of the screen.
    this.barFrame_.className = (
      this.barFrame_.className === 'top' ? 'bottom' : 'top');
    // Keep the bar's idea of which edge it is pinned to in sync: it resizes
    // away from that edge and puts its height divider on the free one.
    chrome.runtime.sendMessage({
      'type': 'barPosition',
      'atBottom': this.barFrame_.className === 'bottom'
    }).catch(function() {});
  } else if (request['type'] === 'toggleBar') {
    this.toggleBar_();
  }
};

xh.Bar.prototype.mouseMove_ = function(e) {
  if (this.currEl_ === e.target) {
    return;
  }
  this.currEl_ = e.target;
  if (e.shiftKey) {
    this.updateQueryAndBar_(this.currEl_);
  }
};

xh.Bar.prototype.keyDown_ = function(e) {
  // If the user just pressed Shift and they're not holding Ctrl, update query.
  // Note that we rely on the mousemove handler to have updated this.currEl_.
  // Also, note that checking e.shiftKey wouldn't work here, since Shift is the
  // key that triggered this event.
  // Toggling the bar itself is handled via chrome.commands / the toolbar
  // button, so the shortcut stays user-reconfigurable.
  if (this.active_ && e.key === 'Shift' && !e.ctrlKey) {
    this.updateQueryAndBar_(this.currEl_);
  }
};


////////////////////////////////////////////////////////////////////////////////
// Initialization code

// Content scripts can be re-injected on extension reload; replace any
// previous instance (e.g. after an update) instead of stacking listeners.
if (window['xhBarInstance']) {
  window['xhBarInstance'].dispose();
}
if (location.href.indexOf('acid3.acidtests.org') === -1) {
  window['xhBarInstance'] = new xh.Bar();
}
