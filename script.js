document.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW failed: ', err));
        });
    }

    // Theme setup
    const themeToggle = document.getElementById('theme-toggle');
    const savedTheme = localStorage.getItem('premium-theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
    }
    
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        localStorage.setItem('premium-theme', isLight ? 'light' : 'dark');
    });

    const todoForm = document.getElementById('todo-form');
    const todoInput = document.getElementById('todo-input');
    const prioritySelect = document.getElementById('todo-priority');
    const dueDateInput = document.getElementById('todo-due-date');
    const activeTodosList = document.getElementById('active-todos-list');
    const focusTodosList = document.getElementById('focus-todos-list');
    const completedTodosList = document.getElementById('completed-todos-list');

    // Storage Module
    const Storage = {
        useIDB: !!window.indexedDB,
        db: null,
        async init() {
            if (this.useIDB) {
                return new Promise((resolve) => {
                    const request = indexedDB.open('PremiumTodoDB', 1);
                    request.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains('todos')) {
                            db.createObjectStore('todos', { keyPath: 'id' });
                        }
                    };
                    request.onsuccess = (e) => {
                        this.db = e.target.result;
                        resolve();
                    };
                    request.onerror = (e) => {
                        console.warn('IndexedDB initialization failed, falling back to localStorage.', e);
                        this.useIDB = false;
                        resolve();
                    };
                });
            }
        },
        async load() {
            if (this.useIDB && this.db) {
                return new Promise((resolve) => {
                    const transaction = this.db.transaction(['todos'], 'readonly');
                    const store = transaction.objectStore('todos');
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => resolve([]);
                });
            } else {
                return JSON.parse(localStorage.getItem('premium-todos')) || [];
            }
        },
        async saveAll(todosArray) {
            if (this.useIDB && this.db) {
                return new Promise((resolve) => {
                    const transaction = this.db.transaction(['todos'], 'readwrite');
                    const store = transaction.objectStore('todos');
                    store.clear();
                    todosArray.forEach(t => store.put(t));
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => resolve();
                });
            } else {
                localStorage.setItem('premium-todos', JSON.stringify(todosArray));
                return Promise.resolve();
            }
        }
    };

    await Storage.init();

    // State
    let todos = await Storage.load();
    let lastActiveState = '';
    let lastFocusState = '';
    let lastCompletedState = '';
    let needsSave = false;
    
    // Migration: LocalStorage -> IndexedDB if IDB is empty
    if (Storage.useIDB && todos.length === 0) {
        const lsTodos = JSON.parse(localStorage.getItem('premium-todos')) || [];
        if (lsTodos.length > 0) {
            todos = lsTodos;
            needsSave = true;
        }
    }
    
    // Migration for new 'status' field
    todos = todos.map(t => {
        if (!t.status) {
            t.status = t.completed ? 'completed' : 'active';
            needsSave = true;
        }
        return t;
    });

    if (needsSave) {
        await Storage.saveAll(todos);
    }

    // Set minimum date for due date input to today (using local time)
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if(dueDateInput) {
        dueDateInput.min = today;
        dueDateInput.value = today;
    }

    // Global Handlers
    window.changeTodoStatus = (id, newStatus) => {
        todos = todos.map(todo => {
            if (todo.id === id) {
                const updated = { ...todo, status: newStatus };
                if (newStatus === 'completed' && !updated.completedAt) {
                    updated.completedAt = new Date().toISOString();
                }
                return updated;
            }
            return todo;
        });
        saveTodos();
    };

    window.deleteTodoHandler = (id) => {
        todos = todos.filter(todo => todo.id !== id);
        saveTodos();
    };

    window.editTodoHandler = (id) => {
        todos = todos.map(t => {
            if(t.id === id) t.isEditing = true;
            return t;
        });
        renderTodos();
    };

    window.saveEditHandler = (id, newText) => {
        if(!newText.trim()) return;
        todos = todos.map(t => {
            if(t.id === id) {
                t.isEditing = false;
                t.text = newText.trim();
            }
            return t;
        });
        saveTodos();
    };

    window.cancelEditHandler = (id) => {
        todos = todos.map(t => {
            if(t.id === id) t.isEditing = false;
            return t;
        });
        renderTodos();
    };

    // Drag and Drop Logic
    function setupDropzone(elementId, targetStatus) {
        const zone = document.getElementById(elementId);
        if(!zone) return;
        zone.addEventListener('dragover', e => {
            e.preventDefault(); 
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', e => {
            zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const id = e.dataTransfer.getData('text/plain');
            if (id) {
                window.changeTodoStatus(id, targetStatus);
            }
        });
    }

    setupDropzone('section-active', 'active');
    setupDropzone('section-focus', 'focus');
    setupDropzone('section-completed', 'completed');

    // Initialize
    renderTodos();

    // Event Listeners
    todoForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = todoInput.value.trim();
        const priority = parseInt(prioritySelect.value, 10) || 2;
        const dueDate = dueDateInput.value;
        if (text) {
            addTodo(text, priority, dueDate);
            todoInput.value = '';
            prioritySelect.value = '2'; // reset to medium
            if(dueDateInput) dueDateInput.value = today; // reset to today
        }
    });

    // Functions
    async function saveTodos() {
        renderTodos(); // Optimistically trigger immediate re-render!
        await Storage.saveAll(todos); // Push into background engine thread
    }

    function addTodo(text, priority = 2, dueDate = '') {
        const newTodo = {
            id: Date.now().toString(),
            text: text,
            priority: priority,
            dueDate: dueDate,
            status: 'active',
            createdAt: new Date().toISOString()
        };
        todos.push(newTodo);
        saveTodos();
    }

    function formatDateOnly(isoString) {
        if(!isoString) return 'Anytime';
        const date = new Date(isoString);
        return date.toLocaleDateString('en-US', { 
            weekday: 'short',
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
        });
    }

    function formatTime(isoString) {
        const date = new Date(isoString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }

    function createTodoElement(todo) {
        const isCompleted = todo.status === 'completed';
        const li = document.createElement('li');
        li.className = `todo-item ${isCompleted ? 'completed-item' : ''}`;
        
        if (todo.isEditing) {
            li.innerHTML = `
                <div class="todo-content" style="flex-direction: column; align-items: stretch; gap: 0.5rem; width: 100%;">
                    <input type="text" id="edit-input-${todo.id}" value="${escapeHTML(todo.text)}" class="edit-input">
                    <div class="action-buttons" style="margin: 0; justify-content: flex-end; width: 100%;">
                        <button class="btn-icon btn-complete" onclick="window.saveEditHandler('${todo.id}', document.getElementById('edit-input-${todo.id}').value)" title="Save">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                        </button>
                        <button class="btn-icon btn-delete" onclick="window.cancelEditHandler('${todo.id}')" title="Cancel">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>
            `;
            setTimeout(() => {
                const input = document.getElementById(`edit-input-${todo.id}`);
                if (input) {
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                }
            }, 0);
            return li;
        }

        // Drag attributes
        li.draggable = true;
        li.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', todo.id);
            li.classList.add('dragging');
        });
        li.addEventListener('dragend', () => {
            li.classList.remove('dragging');
        });

        const priorityLabels = {1: 'Low', 2: 'Medium', 3: 'High'};
        const priorityNum = todo.priority || 2;
        const priorityBadgeHtml = `<span class="priority-badge priority-${priorityNum}">${priorityLabels[priorityNum]}</span>`;

        let metaHtml = '';
        if (isCompleted && todo.completedAt) {
            metaHtml = `
                <div class="meta-row">
                    <span class="completed-date">Completed: ${formatTime(todo.completedAt)}</span>
                </div>
            `;
        } else {
            metaHtml = `
                <div class="meta-row">
                    <span class="todo-meta">Added: ${formatTime(todo.createdAt)}</span>
                    ${!isCompleted ? priorityBadgeHtml : ''}
                </div>
            `;
        }

        const buttonsHtml = isCompleted ? `
            <div class="action-buttons">
                <button class="btn-icon" onclick="window.changeTodoStatus('${todo.id}', 'active')" title="Undo completed">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>
                </button>
                <button class="btn-icon btn-delete" onclick="window.deleteTodoHandler('${todo.id}')" title="Delete">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        ` : `
            <div class="action-buttons">
                <button class="btn-icon" onclick="window.editTodoHandler('${todo.id}')" title="Edit">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="btn-icon btn-complete" onclick="window.changeTodoStatus('${todo.id}', 'completed')" title="Mark as done">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                </button>
                <button class="btn-icon btn-delete" onclick="window.deleteTodoHandler('${todo.id}')" title="Delete">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `;

        li.innerHTML = `
            <div class="todo-content">
                <div>
                    <div class="todo-text">${escapeHTML(todo.text)}</div>
                    ${metaHtml}
                </div>
            </div>
            ${buttonsHtml}
        `;
        return li;
    }

    function sortTodos(a, b) {
        const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (dateA !== dateB) return dateA - dateB;

        const pA = a.priority || 2;
        const pB = b.priority || 2;
        if (pA !== pB) return pB - pA;
        
        return new Date(a.createdAt) - new Date(b.createdAt);
    }

    function renderGroupedList(todoArray, containerElement, emptyMessage, isCompletedList=false) {
        containerElement.innerHTML = '';
        if (todoArray.length === 0) {
            containerElement.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
            return;
        }

        let currentGroupDate = null;
        let currentDiv = null;
        let currentUl = null;

        todoArray.forEach(todo => {
            let dateStr = 'No due date';
            if (isCompletedList) {
                dateStr = formatDateOnly(todo.completedAt);
            } else if (todo.dueDate) {
                const parts = todo.dueDate.split('-');
                const dueObj = new Date(parts[0], parts[1]-1, parts[2]);
                dateStr = dueObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            }

            if (dateStr !== currentGroupDate) {
                currentGroupDate = dateStr;
                currentDiv = document.createElement('div');
                currentDiv.className = 'date-group';
                containerElement.appendChild(currentDiv);

                const dateHeader = document.createElement('h3');
                dateHeader.className = 'date-group-header';
                dateHeader.textContent = dateStr;
                currentDiv.appendChild(dateHeader);
                
                currentUl = document.createElement('ul');
                currentUl.className = 'group-list';
                currentDiv.appendChild(currentUl);
            }
            currentUl.appendChild(createTodoElement(todo));
        });
    }

    function renderTodos() {
        const activeTodos = todos.filter(t => t.status === 'active').sort(sortTodos);
        const focusTodos = todos.filter(t => t.status === 'focus').sort(sortTodos);
        const completedTodos = todos.filter(t => t.status === 'completed').sort((a, b) => {
            return new Date(b.completedAt || 0) - new Date(a.completedAt || 0);
        });

        const newActiveState = JSON.stringify(activeTodos);
        const newFocusState = JSON.stringify(focusTodos);
        const newCompletedState = JSON.stringify(completedTodos);

        if (newActiveState !== lastActiveState) {
            renderGroupedList(activeTodos, activeTodosList, 'No active tasks! ✨');
            lastActiveState = newActiveState;
        }
        
        if (newFocusState !== lastFocusState) {
            renderGroupedList(focusTodos, focusTodosList, 'Drop high priority tasks here 🔥');
            lastFocusState = newFocusState;
        }
        
        if (newCompletedState !== lastCompletedState) {
            renderGroupedList(completedTodos, completedTodosList, 'No completed tasks yet.', true);
            lastCompletedState = newCompletedState;
        }
    }
});
