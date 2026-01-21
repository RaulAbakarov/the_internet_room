/**
 * The Internet Room - Client Application
 * 
 * Handles room entry, heartbeats, content editing, and graceful exit
 */

(function() {
  'use strict';

  // ============================================================
  // State
  // ============================================================
  
  const state = {
    sessionId: null,
    heartbeatInterval: null,
    isInRoom: false,
    config: {
      heartbeatInterval: 12000,
      maxTextLength: 500
    }
  };

  // ============================================================
  // DOM Elements
  // ============================================================
  
  const elements = {
    // Screens
    landing: document.getElementById('landing'),
    room: document.getElementById('room'),
    
    // Status displays
    statusLoading: document.getElementById('status-loading'),
    statusVacant: document.getElementById('status-vacant'),
    statusOccupied: document.getElementById('status-occupied'),
    statusError: document.getElementById('status-error'),
    occupiedTime: document.getElementById('occupied-time'),
    
    // Buttons
    enterBtn: document.getElementById('enter-btn'),
    retryBtn: document.getElementById('retry-btn'),
    leaveBtn: document.getElementById('leave-btn'),
    toggleCanvas: document.getElementById('toggle-canvas'),
    clearCanvas: document.getElementById('clear-canvas'),
    terminatedOk: document.getElementById('terminated-ok'),
    
    // Content display
    previousText: document.getElementById('previous-text'),
    previousCanvas: document.getElementById('previous-canvas'),
    noContent: document.getElementById('no-content'),
    
    // Input
    textInput: document.getElementById('text-input'),
    charCurrent: document.getElementById('char-current'),
    charMax: document.getElementById('char-max'),
    canvasContainer: document.getElementById('canvas-container'),
    drawingCanvas: document.getElementById('drawing-canvas'),
    
    // Overlays
    leavingOverlay: document.getElementById('leaving-overlay'),
    terminatedOverlay: document.getElementById('terminated-overlay')
  };

  // ============================================================
  // Drawing Canvas Setup
  // ============================================================
  
  const canvas = elements.drawingCanvas;
  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;

  function setupCanvas() {
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Mouse events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    
    // Touch events
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);
  }

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function startDrawing(e) {
    isDrawing = true;
    const coords = getCanvasCoords(e);
    lastX = coords.x;
    lastY = coords.y;
  }

  function draw(e) {
    if (!isDrawing) return;
    
    const coords = getCanvasCoords(e);
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    
    lastX = coords.x;
    lastY = coords.y;
  }

  function stopDrawing() {
    isDrawing = false;
  }

  function handleTouchStart(e) {
    e.preventDefault();
    startDrawing(e);
  }

  function handleTouchMove(e) {
    e.preventDefault();
    draw(e);
  }

  function clearDrawingCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function getDrawingData() {
    // Check if canvas has any drawing
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hasDrawing = imageData.data.some((val, i) => i % 4 === 3 && val > 0);
    
    if (!hasDrawing) return null;
    return canvas.toDataURL('image/png');
  }

  // ============================================================
  // API Functions
  // ============================================================
  
  async function checkStatus() {
    try {
      const response = await fetch('/api/status');
      return await response.json();
    } catch (err) {
      console.error('Status check failed:', err);
      return null;
    }
  }

  async function enterRoom() {
    try {
      const response = await fetch('/api/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      return await response.json();
    } catch (err) {
      console.error('Enter failed:', err);
      return { success: false, error: 'Network error' };
    }
  }

  async function sendHeartbeat() {
    if (!state.sessionId) return;
    
    try {
      const response = await fetch('/api/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId })
      });
      
      const result = await response.json();
      
      if (!result.success && result.terminated) {
        handleTermination();
      }
    } catch (err) {
      console.error('Heartbeat failed:', err);
      // Don't terminate on single failure, server will handle timeout
    }
  }

  async function leaveRoom() {
    if (!state.sessionId) return;
    
    const content = {
      text: elements.textInput.value.trim(),
      drawing: getDrawingData()
    };
    
    try {
      await fetch('/api/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sessionId: state.sessionId,
          content 
        })
      });
    } catch (err) {
      console.error('Leave failed:', err);
    }
  }

  // ============================================================
  // UI Functions
  // ============================================================
  
  function showStatus(statusType) {
    elements.statusLoading.classList.add('hidden');
    elements.statusVacant.classList.add('hidden');
    elements.statusOccupied.classList.add('hidden');
    elements.statusError.classList.add('hidden');
    
    switch (statusType) {
      case 'loading':
        elements.statusLoading.classList.remove('hidden');
        break;
      case 'vacant':
        elements.statusVacant.classList.remove('hidden');
        break;
      case 'occupied':
        elements.statusOccupied.classList.remove('hidden');
        break;
      case 'error':
        elements.statusError.classList.remove('hidden');
        break;
    }
  }

  function showLanding() {
    elements.landing.classList.remove('hidden');
    elements.room.classList.add('hidden');
  }

  function showRoom() {
    elements.landing.classList.add('hidden');
    elements.room.classList.remove('hidden');
  }

  function displayPreviousContent(content) {
    const hasText = content.text && content.text.trim().length > 0;
    const hasDrawing = content.drawing;
    
    if (!hasText && !hasDrawing) {
      elements.previousText.classList.add('hidden');
      elements.previousCanvas.classList.add('hidden');
      elements.noContent.classList.remove('hidden');
      return;
    }
    
    elements.noContent.classList.add('hidden');
    
    if (hasText) {
      elements.previousText.textContent = content.text;
      elements.previousText.classList.remove('hidden');
    } else {
      elements.previousText.classList.add('hidden');
    }
    
    if (hasDrawing) {
      const img = new Image();
      img.onload = () => {
        const pctx = elements.previousCanvas.getContext('2d');
        elements.previousCanvas.width = img.width;
        elements.previousCanvas.height = img.height;
        pctx.drawImage(img, 0, 0);
        elements.previousCanvas.classList.remove('hidden');
      };
      img.src = content.drawing;
    } else {
      elements.previousCanvas.classList.add('hidden');
    }
  }

  function updateCharCount() {
    const count = elements.textInput.value.length;
    elements.charCurrent.textContent = count;
  }

  function handleTermination() {
    stopHeartbeat();
    state.isInRoom = false;
    state.sessionId = null;
    elements.terminatedOverlay.classList.remove('hidden');
  }

  // ============================================================
  // Session Management
  // ============================================================
  
  function startHeartbeat() {
    if (state.heartbeatInterval) {
      clearInterval(state.heartbeatInterval);
    }
    
    state.heartbeatInterval = setInterval(() => {
      sendHeartbeat();
    }, state.config.heartbeatInterval);
  }

  function stopHeartbeat() {
    if (state.heartbeatInterval) {
      clearInterval(state.heartbeatInterval);
      state.heartbeatInterval = null;
    }
  }

  async function handleEnter() {
    elements.enterBtn.disabled = true;
    elements.enterBtn.textContent = 'Entering...';
    
    const result = await enterRoom();
    
    if (result.success) {
      state.sessionId = result.sessionId;
      state.isInRoom = true;
      
      if (result.config) {
        state.config = { ...state.config, ...result.config };
        elements.charMax.textContent = state.config.maxTextLength;
        elements.textInput.maxLength = state.config.maxTextLength;
      }
      
      displayPreviousContent(result.content || {});
      showRoom();
      startHeartbeat();
      
      elements.textInput.focus();
    } else {
      elements.enterBtn.disabled = false;
      elements.enterBtn.textContent = 'Enter the Room';
      
      // Room might have become occupied
      refreshStatus();
    }
  }

  async function handleLeave() {
    if (!state.isInRoom) return;
    
    elements.leavingOverlay.classList.remove('hidden');
    stopHeartbeat();
    
    await leaveRoom();
    
    state.isInRoom = false;
    state.sessionId = null;
    
    // Reset UI
    elements.textInput.value = '';
    elements.charCurrent.textContent = '0';
    clearDrawingCanvas();
    elements.canvasContainer.classList.add('hidden');
    elements.toggleCanvas.textContent = '+ Add drawing';
    
    elements.leavingOverlay.classList.add('hidden');
    showLanding();
    refreshStatus();
  }

  async function refreshStatus() {
    showStatus('loading');
    
    const status = await checkStatus();
    
    if (!status) {
      showStatus('error');
      return;
    }
    
    if (status.occupied) {
      showStatus('occupied');
      
      if (status.occupiedMinutes !== undefined) {
        if (status.occupiedMinutes === 0) {
          elements.occupiedTime.textContent = 'Just entered.';
        } else if (status.occupiedMinutes === 1) {
          elements.occupiedTime.textContent = 'For about a minute.';
        } else {
          elements.occupiedTime.textContent = `For about ${status.occupiedMinutes} minutes.`;
        }
      } else {
        elements.occupiedTime.textContent = '';
      }
    } else {
      showStatus('vacant');
    }
  }

  // ============================================================
  // Event Listeners
  // ============================================================
  
  function setupEventListeners() {
    // Enter button
    elements.enterBtn.addEventListener('click', handleEnter);
    
    // Retry button
    elements.retryBtn.addEventListener('click', refreshStatus);
    
    // Leave button
    elements.leaveBtn.addEventListener('click', handleLeave);
    
    // Character count
    elements.textInput.addEventListener('input', updateCharCount);
    
    // Toggle canvas
    elements.toggleCanvas.addEventListener('click', () => {
      const isHidden = elements.canvasContainer.classList.contains('hidden');
      if (isHidden) {
        elements.canvasContainer.classList.remove('hidden');
        elements.toggleCanvas.textContent = '− Hide drawing';
      } else {
        elements.canvasContainer.classList.add('hidden');
        elements.toggleCanvas.textContent = '+ Add drawing';
      }
    });
    
    // Clear canvas
    elements.clearCanvas.addEventListener('click', clearDrawingCanvas);
    
    // Terminated OK button
    elements.terminatedOk.addEventListener('click', () => {
      elements.terminatedOverlay.classList.add('hidden');
      showLanding();
      refreshStatus();
    });
    
    // Handle page unload
    window.addEventListener('beforeunload', (e) => {
      if (state.isInRoom) {
        // Try to send leave request synchronously
        const content = {
          text: elements.textInput.value.trim(),
          drawing: getDrawingData()
        };
        
        // Use sendBeacon for reliable delivery on page close
        navigator.sendBeacon('/api/leave', JSON.stringify({
          sessionId: state.sessionId,
          content
        }));
      }
    });
    
    // Handle visibility change (tab switch)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.isInRoom) {
        // Send a heartbeat when tab becomes hidden
        sendHeartbeat();
      }
    });
  }

  // ============================================================
  // Initialize
  // ============================================================
  
  function init() {
    setupCanvas();
    setupEventListeners();
    refreshStatus();
  }

  // Start the application
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
