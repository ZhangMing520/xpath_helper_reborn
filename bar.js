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

// Constants.
var RELOCATE_COOLDOWN_PERIOD_MS = 400;

// Drag limits: the Query box's share of the bar width, and the shortest the
// boxes may be dragged.
var MIN_QUERY_W_PCT = 20;
var MAX_QUERY_W_PCT = 80;
var MIN_TEXT_H_PX = 40;

// Global variables.
var queryEl = document.getElementById('query');
var resultsEl = document.getElementById('results');
var nodeCountEl = document.getElementById('node-count');
var rowEl = document.getElementById('row');
var queryBoxEl = document.getElementById('query-box');
var vsplitEl = document.getElementById('vsplit');
var hsplitEl = document.getElementById('hsplit');
var resultsListEl = document.getElementById('results-list');
var modeToggleEl = document.getElementById('mode-toggle');
var queryNameEl = document.getElementById('query-name');
var resultsTitleEl = document.getElementById('results-title');

var nodeCountText = document.createTextNode('0');
nodeCountEl.appendChild(nodeCountText);

// The few bits of bar chrome that are plain text rather than data: the box
// names, the count's bracket, and the divider tooltips. Pulled from the
// locale pack (see _locales) so the bar is not English-only.
queryNameEl.textContent = chrome.i18n.getMessage('queryLabel');
resultsTitleEl.insertBefore(
    document.createTextNode(chrome.i18n.getMessage('resultsPrefix')),
    nodeCountEl);
resultsTitleEl.appendChild(
    document.createTextNode(chrome.i18n.getMessage('resultsSuffix')));
vsplitEl.title = chrome.i18n.getMessage('resizeCol');
hsplitEl.title = chrome.i18n.getMessage('resizeRow');

// Used by handleMouseMove() to enforce a cooldown period on relocate.
var mostRecentRelocateTimeInMs = 0;

// True while a divider is being dragged. Relocating then would move the bar out
// from under the pointer mid-drag.
var dragInProgress = false;

var evaluateQuery = function() {
  var request = {
    'type': 'evaluate',
    'query': queryEl.value
  };
  chrome.runtime.sendMessage(request).catch(function() {});
};

// Which view the results box shows. Kept in the iframe's own storage so it
// survives page navigations and the bar iframe being re-created; the content
// script never needs to know, so the update message always carries both forms.
var RESULTS_MODE_KEY = 'xh-results-mode';
var resultsMode =
    localStorage.getItem(RESULTS_MODE_KEY) === 'text' ? 'text' : 'list';

// The last update: its rows (kept so the list can be built lazily - there is no
// point assembling 500 rows per keystroke while the text view is showing), the
// evaluation they came from, and which row the pointer is over.
var lastRows = null;
var lastEvalId = null;
var hoveredIndex = null;

var noteRow = function(className, text) {
  var li = document.createElement('li');
  li.className = className;
  li.textContent = text;
  return li;
};

var renderRows = function(rows, count, message) {
  var frag = document.createDocumentFragment();
  for (var i = 0; i < rows.length; i++) {
    var li = document.createElement('li');
    li.className = 'result-row';
    li.title = rows[i].label + ' — ' + rows[i].text;

    var label = document.createElement('span');
    label.className = 'row-label';
    label.textContent = rows[i].label;

    var text = document.createElement('span');
    text.className = 'row-text';
    text.textContent = rows[i].text;

    li.appendChild(label);
    li.appendChild(text);
    frag.appendChild(li);
  }
  if (message) {
    frag.appendChild(noteRow('result-note', message));
  }
  if (count > rows.length) {
    frag.appendChild(noteRow('result-more',
        chrome.i18n.getMessage('moreNotShown', String(count - rows.length))));
  }
  resultsListEl.replaceChildren(frag);
};

var renderLastRows = function() {
  if (lastRows && resultsMode === 'list') {
    renderRows(lastRows.rows, lastRows.count, lastRows.message);
  }
};

// Ask the content script to outline whichever result the pointer is over.
var sendHover = function() {
  chrome.runtime.sendMessage({
    'type': 'hoverResult',
    'evalId': lastEvalId,
    'index': hoveredIndex
  }).catch(function() {});
};

// The pointer moved onto a row, or off the list entirely (null).
var setHoveredIndex = function(index) {
  if (index === hoveredIndex) {
    return;
  }
  hoveredIndex = index;
  sendHover();
};

// A re-render can drop the row the pointer was on, leaving its index dangling.
// Only a surviving hover needs re-sending: evaluating clears the outline.
var syncHoverAfterRender = function() {
  if (hoveredIndex != null && hoveredIndex >= lastRows.rows.length) {
    hoveredIndex = null;
  }
  if (hoveredIndex != null) {
    sendHover();
  }
};

// The result index of the row an event landed in, or null outside any row.
// Rows are appended in order, so a row's position is its index.
var rowIndexOf = function(e) {
  var row = e.target.closest('.result-row');
  return row ? Array.prototype.indexOf.call(resultsListEl.children, row) : null;
};

var applyMode = function() {
  var listMode = resultsMode === 'list';
  resultsListEl.hidden = !listMode;
  resultsEl.hidden = listMode;
  // The button names the view it switches to.
  modeToggleEl.textContent = listMode
      ? chrome.i18n.getMessage('modeText') : chrome.i18n.getMessage('modeList');
  modeToggleEl.title = listMode
      ? chrome.i18n.getMessage('modeTitleText')
      : chrome.i18n.getMessage('modeTitleList');
};

var toggleMode = function() {
  resultsMode = resultsMode === 'list' ? 'text' : 'list';
  localStorage.setItem(RESULTS_MODE_KEY, resultsMode);
  applyMode();
  if (resultsMode === 'list') {
    // The rows were skipped while the text view was showing.
    renderLastRows();
  } else {
    // The rows are gone from view, so the outline they were driving goes too.
    setHoveredIndex(null);
  }
};

var handleRequest = function(request, sender, callback) {
  // Note: Setting textarea's value and text node's nodeValue is XSS-safe.
  // Loose != null so an absent (undefined) field is skipped, not rendered.
  if (request['type'] === 'update') {
    if (request['query'] != null) {
      queryEl.value = request['query'];
    }
    if (request['str'] != null) {
      lastEvalId = request['evalId'];
      resultsEl.value = request['str'];
      nodeCountText.nodeValue = request['label'];
      lastRows = {
        'rows': request['rows'] || [],
        'count': request['count'],
        'message': request['message'] || ''
      };
      renderLastRows();
      syncHoverAfterRender();
    }
  } else if (request['type'] === 'barPosition') {
    document.body.classList.toggle('at-bottom', request['atBottom']);
  }
};

var handleMouseMove = function(e) {
  if (e.shiftKey && !dragInProgress) {
    // Only relocate if we aren't in the cooldown period. Note, the cooldown
    // duration should take CSS transition time into consideration.
    var timeInMs = new Date().getTime();
    if (timeInMs - mostRecentRelocateTimeInMs < RELOCATE_COOLDOWN_PERIOD_MS) {
      return;
    }
    mostRecentRelocateTimeInMs = timeInMs;

    // Tell content script to move iframe to a different part of the screen.
    chrome.runtime.sendMessage({'type': 'relocateBar'}).catch(function() {});
  }
};

queryEl.addEventListener('keyup', evaluateQuery);
queryEl.addEventListener('mouseup', evaluateQuery);

modeToggleEl.addEventListener('click', toggleMode);
// Keep the caret in the query box rather than moving focus to the button.
modeToggleEl.addEventListener('mousedown', function(e) { e.preventDefault(); });
applyMode();

// Delegated, so it keeps working across the list being re-rendered: hovering a
// row (or its label or text) outlines that one result on the page.
resultsListEl.addEventListener('mouseover', function(e) {
  setHoveredIndex(rowIndexOf(e));
});
resultsListEl.addEventListener('mouseleave', function() {
  setHoveredIndex(null);
});
// Leaving the iframe altogether does not fire mouseleave on the list.
document.addEventListener('mouseout', function(e) {
  if (!e.relatedTarget) {
    setHoveredIndex(null);
  }
});

// Double clicking a row makes that result the query, the same way shift-hovering
// the node on the page does. The query box is filled by the content script's
// update, which carries the XPath it built.
resultsListEl.addEventListener('dblclick', function(e) {
  var index = rowIndexOf(e);
  if (index == null) {
    return;
  }
  chrome.runtime.sendMessage({
    'type': 'pickResult',
    'evalId': lastEvalId,
    'index': index
  }).catch(function() {});
});

// Double clicking a line in the text view selects the whole line: that view is
// line oriented, while a textarea's own double click only grabs one word. It
// deliberately does not copy - nothing on screen would say that it had, and
// anyone who wants it on the clipboard presses Ctrl+C anyway.
resultsEl.addEventListener('dblclick', function(e) {
  e.preventDefault();
  var value = resultsEl.value;
  var lineStart = value.lastIndexOf('\n', resultsEl.selectionStart - 1) + 1;
  var nextBreak = value.indexOf('\n', resultsEl.selectionEnd);
  var lineEnd = nextBreak === -1 ? value.length : nextBreak;
  resultsEl.setSelectionRange(lineStart, lineEnd);
});

// Both dividers are dragged the same way: watch the document for the pointer
// until it is released. onStart runs once as the drag begins and returns the
// state onMove/onEnd receive; onEnd runs on release, including a release that
// is only noticed later.
var addDragHandler = function(handleEl, onStart, onMove, onEnd) {
  handleEl.addEventListener('pointerdown', function(e) {
    var pointerId = e.pointerId;
    e.preventDefault();

    try {
      handleEl.setPointerCapture(pointerId);
    } catch (err) {
      // Best effort only: the document listeners below still cover the drag
      // while the pointer stays within the element.
    }

    var state = onStart(e);
    dragInProgress = true;

    var handleMove = function(ev) {
      if (ev.pointerId !== pointerId) {
        return;
      }
      // A release outside the window never reaches us, so notice it here
      // rather than leaving the listeners attached.
      if (!ev.buttons) {
        handleUp();
        return;
      }
      onMove(ev, state);
    };

    var handleUp = function() {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleUp);
      dragInProgress = false;
      onEnd(state);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', handleUp);
  });
};

// Trade width between the two boxes by writing --query-w on <body>: #query-box
// uses it as its flex-basis and #results-box takes the rest, so the two always
// add up to the full width.
addDragHandler(vsplitEl, function(e) {
  return {
    startX: e.clientX,
    rowW: rowEl.clientWidth,
    startPct: queryBoxEl.offsetWidth / rowEl.clientWidth * 100
  };
}, function(ev, state) {
  var pct = state.startPct + (ev.clientX - state.startX) / state.rowW * 100;
  pct = Math.max(MIN_QUERY_W_PCT, Math.min(MAX_QUERY_W_PCT, pct));
  document.body.style.setProperty('--query-w', pct + '%');
}, function() {});

// Change how tall both boxes are; they share --text-h, so the bar resizes as a
// whole. The bar cannot resize its own iframe, so the content script does it:
// 'resizeStart' stretches the iframe over the host viewport for the duration of
// the drag, 'resizeEnd' hands it the height to settle on. That stretch is what
// makes the drag work at all - the pointer has to travel below the bar's box to
// make it taller, and pointer events stop dead at the iframe's edge.
addDragHandler(hsplitEl, function(e) {
  var startTextH = queryEl.offsetHeight;
  var state = {
    startY: e.clientY,
    startTextH: startTextH,
    // Everything in the bar that isn't a textarea - labels, padding, the
    // bottom divider. Constant during the drag, so it caps how tall the boxes
    // may get: any taller and the bar would push its own divider off screen.
    chromeH: document.body.offsetHeight - startTextH,
    // The bar's own height until 'resizeStart' is applied (see onMove).
    preStretchH: window.innerHeight,
    // Snapshot: the drag keeps its direction even if the bar relocates.
    atBottom: document.body.classList.contains('at-bottom'),
    maxTextH: Infinity
  };
  chrome.runtime.sendMessage({'type': 'resizeStart'}).catch(function() {});
  return state;
}, function(ev, state) {
  if (state.maxTextH === Infinity && window.innerHeight > state.preStretchH) {
    var stretchDelta = window.innerHeight - state.preStretchH;
    state.maxTextH = window.innerHeight - state.chromeH;
    if (state.atBottom) {
      // Stretching a bottom-pinned bar lifts its iframe to the top of the host
      // viewport, so clientY values jump by that much; shift the baseline
      // captured before the stretch into the new coordinate space.
      state.startY += stretchDelta;
    }
  }
  var dy = ev.clientY - state.startY;
  if (state.atBottom) {
    // Pinned to the bottom, the bar grows away from that edge, i.e. upwards.
    dy = -dy;
  }
  var textH = Math.min(state.startTextH + dy, state.maxTextH);
  document.body.style.setProperty(
      '--text-h', Math.max(MIN_TEXT_H_PX, textH) + 'px');
}, function() {
  chrome.runtime.sendMessage({
    'type': 'resizeEnd',
    'height': document.body.offsetHeight
  }).catch(function() {});
});

// Add mousemove listener so we can detect Shift + mousemove inside iframe.
document.addEventListener('mousemove', handleMouseMove);
// Ctrl-Shift-X toggling is a browser-level extension command (see manifest
// "commands"), so bar.js does not need its own keydown handler.

chrome.runtime.onMessage.addListener(handleRequest);

var request = {
  'type': 'height',
  'height': document.documentElement.offsetHeight
};
chrome.runtime.sendMessage(request).catch(function() {});
