class OnePiece3DChess {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.board = [];
        this.boardSquares = [];
        this.pieces = [];
        this.currentPlayer = 'pirate';
        this.selectedPiece = null;
        this.turnNumber = 1;
        this.moveHistory = [];
        this.capturedPieces = { marine: [], pirate: [] };
        this.availableDevilFruits = [];
        this.devilFruitCounter = 7;
        this.selectedCrew = null;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.particleSystem = null;
        this.ambientLight = null;
        this.directionalLight = null;
        this.spotLight = null;
        this.animationId = null;
        this.aiEnabled = true;
        this.aiThinking = false;
        this.aiDifficulty = 'medium'; // easy, medium, hard
        
        // Pirate Crews with 3D models and textures
        this.pirateCrews = {
            mugiwara: {
                name: 'Mugiwara Pirates',
                king: { model: 'king', name: 'Luffy', texture: 'assets/crews/mugiwara/king.png' },
                queen: { model: 'queen', name: 'Zoro', texture: 'assets/crews/mugiwara/queen.png' },
                rook: { model: 'rook', name: 'Nami', texture: 'assets/crews/mugiwara/rook.png' },
                bishop: { model: 'bishop', name: 'Sanji', texture: 'assets/crews/mugiwara/bishop.png' },
                knight: { model: 'knight', name: 'Usopp', texture: 'assets/crews/mugiwara/knight.png' },
                pawn: { model: 'pawn', name: 'Chopper', texture: 'assets/crews/mugiwara/pawn.png' }
            },
            buggy: {
                name: 'Buggy Pirates',
                king: { model: 'king', name: 'Buggy', texture: 'assets/crews/buggy/king.png' },
                queen: { model: 'queen', name: 'Alvida', texture: 'assets/crews/buggy/queen.png' },
                rook: { model: 'rook', name: 'Mohji', texture: 'assets/crews/buggy/rook.png' },
                bishop: { model: 'bishop', name: 'Cabaji', texture: 'assets/crews/buggy/bishop.png' },
                knight: { model: 'knight', name: 'Richie', texture: 'assets/crews/buggy/knight.png' },
                pawn: { model: 'pawn', name: 'Crew', texture: 'assets/crews/buggy/pawn.png' }
            },
            shanks: {
                name: 'Red Hair Pirates',
                king: { model: 'king', name: 'Shanks', texture: 'assets/crews/shanks/king.png' },
                queen: { model: 'queen', name: 'Beckman', texture: 'assets/crews/shanks/queen.png' },
                rook: { model: 'rook', name: 'Yasopp', texture: 'assets/crews/shanks/rook.png' },
                bishop: { model: 'bishop', name: 'Lucky Roux', texture: 'assets/crews/shanks/bishop.png' },
                knight: { model: 'knight', name: 'Rockstar', texture: 'assets/crews/shanks/knight.png' },
                pawn: { model: 'pawn', name: 'Crew', texture: 'assets/crews/shanks/pawn.png' }
            },
            bigmom: {
                name: 'Big Mom Pirates',
                king: { model: 'king', name: 'Big Mom', texture: 'assets/crews/bigmom/king.png' },
                queen: { model: 'queen', name: 'Katakuri', texture: 'assets/crews/bigmom/queen.png' },
                rook: { model: 'rook', name: 'Cracker', texture: 'assets/crews/bigmom/rook.png' },
                bishop: { model: 'bishop', name: 'Smoothie', texture: 'assets/crews/bigmom/bishop.png' },
                knight: { model: 'knight', name: 'Perospero', texture: 'assets/crews/bigmom/knight.png' },
                pawn: { model: 'pawn', name: 'Crew', texture: 'assets/crews/bigmom/pawn.png' }
            },
            kaido: {
                name: 'Beast Pirates',
                king: { model: 'king', name: 'Kaido', texture: 'assets/crews/kaido/king.png' },
                queen: { model: 'queen', name: 'King', texture: 'assets/crews/kaido/queen.png' },
                rook: { model: 'rook', name: 'Queen', texture: 'assets/crews/kaido/rook.png' },
                bishop: { model: 'bishop', name: 'Jack', texture: 'assets/crews/kaido/bishop.png' },
                knight: { model: 'knight', name: 'Whos Who', texture: 'assets/crews/kaido/knight.png' },
                pawn: { model: 'pawn', name: 'Crew', texture: 'assets/crews/kaido/pawn.png' }
            },
            doflamingo: {
                name: 'Donquixote Pirates',
                king: { model: 'king', name: 'Doflamingo', texture: 'assets/crews/doflamingo/king.png' },
                queen: { model: 'queen', name: 'Vergo', texture: 'assets/crews/doflamingo/queen.png' },
                rook: { model: 'rook', name: 'Trebol', texture: 'assets/crews/doflamingo/rook.png' },
                bishop: { model: 'bishop', name: 'Diamante', texture: 'assets/crews/doflamingo/bishop.png' },
                knight: { model: 'knight', name: 'Pica', texture: 'assets/crews/doflamingo/knight.png' },
                pawn: { model: 'pawn', name: 'Crew', texture: 'assets/crews/doflamingo/pawn.png' }
            },
            heart: {
                name: 'Heart Pirates',
                king: { model: 'king', name: 'Law', texture: 'assets/crews/heart/king.png' },
                queen: { model: 'queen', name: 'Bepo', texture: 'assets/crews/heart/queen.png' },
                rook: { model: 'rook', name: 'Jean Bart', texture: 'assets/crews/heart/rook.png' },
                bishop: { model: 'bishop', name: 'Shachi', texture: 'assets/crews/heart/bishop.png' },
                knight: { model: 'knight', name: 'Penguin', texture: 'assets/crews/heart/knight.png' },
                pawn: { model: 'pawn', name: 'Crew', texture: 'assets/crews/heart/pawn.png' }
            },
            kid: {
                name: 'Kid Pirates',
                king: { model: 'king', name: 'Kid', texture: 'assets/crews/kid/king.png' },
                queen: { model: 'queen', name: 'Killer', texture: 'assets/crews/kid/queen.png' },
                rook: { model: 'rook', name: 'Heat', texture: 'assets/crews/kid/rook.png' },
                bishop: { model: 'bishop', name: 'Wire', texture: 'assets/crews/kid/bishop.png' },
                knight: { model: 'knight', name: 'Shark', texture: 'assets/crews/kid/knight.png' },
                pawn: { model: 'pawn', name: 'Crew', texture: 'assets/crews/kid/pawn.png' }
            },
            blackbeard: {
                name: 'Blackbeard Pirates',
                king: { model: 'king', name: 'Blackbeard', texture: 'assets/crews/blackbeard/king.png' },
                queen: { model: 'queen', name: 'Burgess', texture: 'assets/crews/blackbeard/queen.png' },
                rook: { model: 'rook', name: 'Shiryu', texture: 'assets/crews/blackbeard/rook.png' },
                bishop: { model: 'bishop', name: 'Van Augur', texture: 'assets/crews/blackbeard/bishop.png' },
                knight: { model: 'knight', name: 'Laffitte', texture: 'assets/crews/blackbeard/knight.png' },
                pawn: { model: 'pawn', name: 'Crew', texture: 'assets/crews/blackbeard/pawn.png' }
            },
            whitebeard: {
                name: 'Whitebeard Pirates',
                king: { model: 'king', name: 'Whitebeard', texture: 'assets/crews/whitebeard/king.png' },
                queen: { model: 'queen', name: 'Marco', texture: 'assets/crews/whitebeard/queen.png' },
                rook: { model: 'rook', name: 'Ace', texture: 'assets/crews/whitebeard/rook.png' },
                bishop: { model: 'bishop', name: 'Jozu', texture: 'assets/crews/whitebeard/bishop.png' },
                knight: { model: 'knight', name: 'Vista', texture: 'assets/crews/whitebeard/knight.png' },
                pawn: { model: 'pawn', name: 'Crew', texture: 'assets/crews/whitebeard/pawn.png' }
            }
        };

        // Marine pieces
        this.marinePieces = {
            king: { model: 'king', name: 'Sengoku', texture: 'assets/marines/king.png' },
            queen: { model: 'queen', name: 'Akainu', texture: 'assets/marines/queen.png' },
            rook: { model: 'rook', name: 'Garp', texture: 'assets/marines/rook.png' },
            bishop: { model: 'bishop', name: 'Smoker', texture: 'assets/marines/bishop.png' },
            knight: { model: 'knight', name: 'Tashigi', texture: 'assets/marines/knight.png' },
            pawn: { model: 'pawn', name: 'Marine', texture: 'assets/marines/pawn.png' }
        };

        // Devil Fruit sprites
        this.devilFruitSprites = {
            'gomu-gomu': 'assets/devil-fruits/gomu-gomu.png',
            'mera-mera': 'assets/devil-fruits/mera-mera.png',
            'ope-ope': 'assets/devil-fruits/ope-ope.png',
            'gora-gora': 'assets/devil-fruits/gora-gora.png'
        };

        // AI piece values for evaluation
        this.pieceValues = {
            'pawn': 10,
            'knight': 30,
            'bishop': 30,
            'rook': 50,
            'queen': 90,
            'king': 900
        };

        this.init();
    }

    // AI Chess Engine
    evaluatePosition() {
        let score = 0;
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece) {
                    const pieceValue = this.pieceValues[piece.type] || 0;
                    const positionBonus = this.getPositionBonus(piece.type, row, col, piece.player);
                    
                    if (piece.player === 'marine') {
                        score += pieceValue + positionBonus;
                    } else {
                        score -= pieceValue + positionBonus;
                    }
                }
            }
        }
        
        return score;
    }

    getPositionBonus(pieceType, row, col, player) {
        // Adjust row for player perspective
        const adjustedRow = player === 'marine' ? 7 - row : row;
        
        switch (pieceType) {
            case 'pawn':
                return adjustedRow * 2; // Pawns more valuable as they advance
            case 'knight':
                // Knights better in center
                const centerDistance = Math.abs(3.5 - row) + Math.abs(3.5 - col);
                return Math.max(0, 8 - centerDistance);
            case 'bishop':
                return Math.abs(3.5 - row) + Math.abs(3.5 - col) < 2 ? 5 : 0;
            case 'rook':
                return 0; // Rooks don't have strong positional preferences
            case 'queen':
                return Math.abs(3.5 - row) + Math.abs(3.5 - col) < 2 ? 5 : 0;
            case 'king':
                // King safer on back rank early game
                return adjustedRow < 2 ? 10 : -adjustedRow;
            default:
                return 0;
        }
    }

    getAllPossibleMoves(player) {
        const moves = [];
        
        for (let fromRow = 0; fromRow < 8; fromRow++) {
            for (let fromCol = 0; fromCol < 8; fromCol++) {
                const piece = this.board[fromRow][fromCol];
                if (piece && piece.player === player) {
                    for (let toRow = 0; toRow < 8; toRow++) {
                        for (let toCol = 0; toCol < 8; toCol++) {
                            if (this.isValidMove(fromRow, fromCol, toRow, toCol)) {
                                moves.push({
                                    from: { row: fromRow, col: fromCol },
                                    to: { row: toRow, col: toCol },
                                    piece: piece,
                                    capturedPiece: this.board[toRow][toCol]
                                });
                            }
                        }
                    }
                }
            }
        }
        
        return moves;
    }

    minimax(depth, isMaximizing, alpha, beta) {
        if (depth === 0) {
            return this.evaluatePosition();
        }
        
        const player = isMaximizing ? 'marine' : 'pirate';
        const moves = this.getAllPossibleMoves(player);
        
        if (moves.length === 0) {
            // No moves available - likely checkmate or stalemate
            return isMaximizing ? -10000 : 10000;
        }
        
        if (isMaximizing) {
            let maxEval = -Infinity;
            for (const move of moves) {
                // Make move
                const originalPiece = this.board[move.to.row][move.to.col];
                this.board[move.to.row][move.to.col] = move.piece;
                this.board[move.from.row][move.from.col] = null;
                
                const evaluation = this.minimax(depth - 1, false, alpha, beta);
                
                // Undo move
                this.board[move.from.row][move.from.col] = move.piece;
                this.board[move.to.row][move.to.col] = originalPiece;
                
                maxEval = Math.max(maxEval, evaluation);
                alpha = Math.max(alpha, evaluation);
                
                if (beta <= alpha) break; // Alpha-beta pruning
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const move of moves) {
                // Make move
                const originalPiece = this.board[move.to.row][move.to.col];
                this.board[move.to.row][move.to.col] = move.piece;
                this.board[move.from.row][move.from.col] = null;
                
                const evaluation = this.minimax(depth - 1, true, alpha, beta);
                
                // Undo move
                this.board[move.from.row][move.from.col] = move.piece;
                this.board[move.to.row][move.to.col] = originalPiece;
                
                minEval = Math.min(minEval, evaluation);
                beta = Math.min(beta, evaluation);
                
                if (beta <= alpha) break; // Alpha-beta pruning
            }
            return minEval;
        }
    }

    getBestAIMove() {
        const depth = this.aiDifficulty === 'easy' ? 2 : this.aiDifficulty === 'medium' ? 3 : 4;
        const moves = this.getAllPossibleMoves('marine');
        
        if (moves.length === 0) return null;
        
        let bestMove = moves[0];
        let bestValue = -Infinity;
        
        for (const move of moves) {
            // Make move
            const originalPiece = this.board[move.to.row][move.to.col];
            this.board[move.to.row][move.to.col] = move.piece;
            this.board[move.from.row][move.from.col] = null;
            
            const moveValue = this.minimax(depth - 1, false, -Infinity, Infinity);
            
            // Undo move
            this.board[move.from.row][move.from.col] = move.piece;
            this.board[move.to.row][move.to.col] = originalPiece;
            
            // Add some randomness for lower difficulties
            const randomFactor = this.aiDifficulty === 'easy' ? Math.random() * 20 - 10 : 
                                this.aiDifficulty === 'medium' ? Math.random() * 10 - 5 : 0;
            const adjustedValue = moveValue + randomFactor;
            
            if (adjustedValue > bestValue) {
                bestValue = adjustedValue;
                bestMove = move;
            }
        }
        
        return bestMove;
    }

    async makeAIMove() {
        if (this.aiThinking || this.currentPlayer !== 'marine' || !this.aiEnabled) return;
        
        this.aiThinking = true;
        this.showMessage('Marine AI is thinking...', 'info');
        
        // Add delay to make AI seem more natural
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        
        const bestMove = this.getBestAIMove();
        
        if (bestMove) {
            console.log(`🤖 AI chose move: ${bestMove.piece.type} from (${bestMove.from.row},${bestMove.from.col}) to (${bestMove.to.row},${bestMove.to.col})`);
            this.makeMove(bestMove.from.row, bestMove.from.col, bestMove.to.row, bestMove.to.col, () => {
                // Reset AI thinking flag and clear message only after move animation completes
                this.aiThinking = false;
                this.clearMessage();
            });
        } else {
            console.log('🤖 AI has no valid moves');
            this.aiThinking = false;
            this.clearMessage();
        }
    }

    createTextTexture(text) {
        // Create a canvas to draw text on
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 128;

        // Draw background
        context.fillStyle = 'rgba(255, 255, 255, 0.8)';
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Draw text
        context.fillStyle = '#000000';
        context.font = '16px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        
        // Split long text into multiple lines
        const words = text.split(' ');
        const lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = context.measureText(currentLine + ' ' + word).width;
            if (width < canvas.width - 20) {
                currentLine += ' ' + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);

        // Draw each line
        const lineHeight = 20;
        const startY = canvas.height / 2 - (lines.length - 1) * lineHeight / 2;
        lines.forEach((line, index) => {
            context.fillText(line, canvas.width / 2, startY + index * lineHeight);
        });

        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    async init() {
        console.log('🎯 Initializing Three.js...');
        await this.initThreeJS();
        console.log('🎯 Creating 3D board...');
        this.create3DBoard();
        console.log('🎯 Setting up event listeners...');
        this.setupEventListeners();
        console.log('🎯 Updating display...');
        this.updateDisplay();
        console.log('🎯 Spawning devil fruits...');
        this.spawnDevilFruits();
        console.log('🎯 Starting animation loop...');
        this.animate();
        console.log('🎯 Hiding loading screen...');
        this.hideLoadingScreen();
        
        // Set up event listeners again after DOM is fully loaded
        setTimeout(() => {
            console.log('🎯 Setting up event listeners again after DOM load...');
            this.setupEventListeners();
        }, 100);
        
        console.log('🎯 Game initialization complete!');
    }

    hideLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        const gameUI = document.getElementById('game-ui');
        
        if (loadingScreen && gameUI) {
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                gameUI.style.display = 'block';
            }, 500);
        }
    }

    setupEventListeners() {
        // Mouse events for 3D board (piece selection only)
        this.renderer.domElement.addEventListener('click', (e) => {
            this.handleMouseClick(e);
        });

        this.renderer.domElement.addEventListener('mousemove', (e) => {
            this.handleMouseMove(e);
        });

        // Keyboard controls for camera movement
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardInput(e);
        });

        // Allow clicking on game message to dismiss it
        const messageElement = document.getElementById('game-message');
        if (messageElement) {
            messageElement.addEventListener('click', () => {
                this.clearMessage();
            });
        }

        // Crew selection - add some debugging
        console.log('🎯 Setting up crew selection event listeners...');
        const crewButtons = document.querySelectorAll('.crew-btn');
        console.log(`🎯 Found ${crewButtons.length} crew buttons`);
        
        crewButtons.forEach((btn, index) => {
            console.log(`🎯 Setting up listener for button ${index}: ${btn.textContent} (data-crew: ${btn.dataset.crew})`);
            btn.addEventListener('click', (e) => {
                console.log(`🎯 Crew button clicked: ${e.target.dataset.crew}`);
                this.selectCrew(e.target.dataset.crew);
            });
        });

        // Game controls
        document.getElementById('new-game-btn').addEventListener('click', () => {
            this.resetGame();
        });

        document.getElementById('undo-btn').addEventListener('click', () => {
            this.undoMove();
        });

        document.getElementById('change-crew-btn').addEventListener('click', () => {
            this.showCrewSelection();
        });

        document.getElementById('camera-reset-btn').addEventListener('click', () => {
            this.resetCamera();
        });

        document.getElementById('ai-toggle-btn').addEventListener('click', () => {
            this.aiEnabled = !this.aiEnabled;
            document.getElementById('ai-toggle-btn').textContent = `AI: ${this.aiEnabled ? 'ON' : 'OFF'}`;
            this.showMessage(`Marine AI ${this.aiEnabled ? 'enabled' : 'disabled'}`, 'info');
            
            // Trigger AI move if it's marine's turn and AI was just enabled
            if (this.aiEnabled && this.currentPlayer === 'marine' && !this.aiThinking) {
                setTimeout(() => this.makeAIMove(), 500);
            }
        });

        document.getElementById('ai-difficulty').addEventListener('change', (e) => {
            this.aiDifficulty = e.target.value;
            this.showMessage(`AI difficulty set to ${this.aiDifficulty}`, 'info');
        });
    }

    resetCamera() {
        this.camera.position.set(0, 15, 15);
        this.camera.lookAt(0, 0, 0);
        // No controls to reset since we removed OrbitControls
    }

    showCrewSelection() {
        document.getElementById('crew-selection').style.display = 'block';
        document.getElementById('game-info').style.display = 'none';
        document.getElementById('side-panel').style.display = 'none';
        document.getElementById('game-controls').style.display = 'none';
    }

    handleMouseClick(event) {
        console.log('🖱️ Mouse click detected at:', event.clientX, event.clientY);
        
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children);

        console.log(`🎯 Raycaster found ${intersects.length} intersections`);

        for (const intersect of intersects) {
            console.log('🎯 Intersection with object:', intersect.object.userData);
            
            // Prioritize piece clicks over square clicks
            if (intersect.object.userData.player) {
                // Clicked on a piece (sprite) - handle this first
                console.log(`🎯 Clicked on piece: ${intersect.object.userData.player} ${intersect.object.userData.type}`);
                this.handlePieceClick(intersect.object);
                break;
            } else if (intersect.object.userData.row !== undefined && intersect.object.userData.col !== undefined) {
                // Clicked on a board square
                console.log(`🎯 Clicked on board square: ${intersect.object.userData.row}, ${intersect.object.userData.col}`);
                this.handleSquareClick(intersect.object.userData.row, intersect.object.userData.col);
                break;
            }
        }
        
        if (intersects.length === 0) {
            console.log('🎯 No intersections found - clicked on empty space');
        }
    }

    handleMouseMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children);

        // Reset all piece scales
        this.pieces.forEach(piece => {
            piece.scale.setScalar(1);
        });

        // Highlight hovered piece
        for (const intersect of intersects) {
            if (intersect.object.userData.player) {
                intersect.object.scale.setScalar(1.1);
                break;
            }
        }
    }

    handleKeyboardInput(event) {
        const moveSpeed = 2;
        const rotateSpeed = 0.1;
        const zoomSpeed = 1;

        switch(event.key.toLowerCase()) {
            // Camera movement
            case 'w':
            case 'arrowup':
                this.camera.position.z -= moveSpeed;
                break;
            case 's':
            case 'arrowdown':
                this.camera.position.z += moveSpeed;
                break;
            case 'a':
            case 'arrowleft':
                this.camera.position.x -= moveSpeed;
                break;
            case 'd':
            case 'arrowright':
                this.camera.position.x += moveSpeed;
                break;
            
            // Camera rotation
            case 'q':
                this.camera.rotation.y += rotateSpeed;
                break;
            case 'e':
                this.camera.rotation.y -= rotateSpeed;
                break;
            
            // Camera zoom
            case 'r':
                this.camera.position.y += zoomSpeed;
                break;
            case 'f':
                this.camera.position.y -= zoomSpeed;
                break;
            
            // Reset camera
            case 'c':
                this.resetCamera();
                break;
            
            // Prevent default behavior for game keys
            default:
                return;
        }
        
        // Prevent default behavior for game keys
        event.preventDefault();
        
        // Update camera to look at center
        this.camera.lookAt(0, 0, 0);
    }

    handlePieceClick(piece) {
        console.log('🎯 handlePieceClick called with piece:', piece.userData);
        const { player, row, col } = piece.userData;
        
        console.log(`🎯 Current player: ${this.currentPlayer}, Piece player: ${player}, AI enabled: ${this.aiEnabled}`);
        
        // Prevent human from controlling Marine pieces when AI is enabled
        if (player === 'marine' && this.aiEnabled) {
            console.log('🎯 Blocked marine piece selection - AI controlled');
            this.showMessage('Marine pieces are controlled by AI', 'error');
            return;
        }
        
        // Allow selecting while AI is thinking; only block making a move elsewhere
        
        if (player === this.currentPlayer) {
            console.log(`🎯 Selecting piece at ${row}, ${col}`);
            this.selectPiece(row, col);
        } else if (this.selectedPiece) {
            console.log('🎯 Attempting capture move');
            // Try to capture
            const selectedPieceData = this.selectedPiece.userData;
            const selectedRow = selectedPieceData.row;
            const selectedCol = selectedPieceData.col;
            if (this.isValidMove(selectedRow, selectedCol, row, col)) {
                this.makeMove(selectedRow, selectedCol, row, col);
            }
        } else {
            console.log(`🎯 Cannot select piece - wrong player turn (current: ${this.currentPlayer}, piece: ${player})`);
        }
    }

    selectCrew(crewName) {
        console.log(`🎯 selectCrew called with: ${crewName}`);
        
        if (!crewName || !this.pirateCrews[crewName]) {
            console.error(`🎯 Invalid crew name: ${crewName}`);
            return;
        }
        
        this.selectedCrew = crewName;
        console.log(`🎯 Selected crew: ${this.pirateCrews[crewName].name}`);
        
        const selectedCrewNameElement = document.getElementById('selected-crew-name');
        if (selectedCrewNameElement) {
            selectedCrewNameElement.textContent = this.pirateCrews[crewName].name;
        } else {
            console.error('🎯 Could not find selected-crew-name element');
        }
        
        // Hide crew selection and show game
        const crewSelection = document.getElementById('crew-selection');
        const gameInfo = document.getElementById('game-info');
        const sidePanel = document.getElementById('side-panel');
        const gameControls = document.getElementById('game-controls');
        
        if (crewSelection) crewSelection.style.display = 'none';
        if (gameInfo) gameInfo.style.display = 'block';
        if (sidePanel) sidePanel.style.display = 'block';
        if (gameControls) gameControls.style.display = 'block';

        console.log('🎯 Creating pirate pieces...');
        // Create pirate pieces
        this.createPiratePieces();
        
        // Set pirates to move first
        this.currentPlayer = 'pirate';
        this.updateDisplay();
        
        this.showMessage(`Selected ${this.pirateCrews[crewName].name}! Pirates go first.`, 'success');
    }

    selectPiece(row, col) {
        const piece = this.board[row][col];
        if (!piece) return;

        this.clearHighlights();
        this.selectedPiece = piece.mesh;
        this.highlightSquare(row, col, 'selected');
        this.showPossibleMoves(row, col);
        console.log(`✅ Piece selected: ${piece.player} ${piece.type} at (${row},${col})`);
    }

    handleSquareClick(row, col) {
        // Prevent moves while AI is thinking
        if (this.aiThinking) {
            this.showTemporaryMessage('AI is thinking, please wait...', 'info', 1000);
            return;
        }
        
        const piece = this.board[row][col];

        if (this.selectedPiece) {
            const selectedPieceData = this.selectedPiece.userData;
            const selectedRow = selectedPieceData.row;
            const selectedCol = selectedPieceData.col;

            // If clicking on the same piece, deselect it
            if (row === selectedRow && col === selectedCol) {
                this.clearHighlights();
                this.selectedPiece = null;
                return;
            }

            // If clicking on a piece of the same player, select it instead
            if (piece && piece.player === selectedPieceData.player) {
                this.selectPiece(row, col);
                return;
            }

            // Try to move the selected piece
            if (this.isValidMove(selectedRow, selectedCol, row, col)) {
                this.makeMove(selectedRow, selectedCol, row, col);
                this.selectedPiece = null;
                return;
            }
        }

        // Select a piece if it belongs to the current player
        if (piece && piece.player === this.currentPlayer) {
            this.selectPiece(row, col);
        }
    }

    undoMove() {
        if (this.moveHistory.length === 0) {
            this.showMessage('No moves to undo', 'error');
            return;
        }

        const lastMove = this.moveHistory.pop();
        const { from, to, piece, captured } = lastMove;

        // Restore the moved piece
        this.board[from[0]][from[1]] = piece;
        this.board[to[0]][to[1]] = captured;

        // Update 3D scene
        if (piece.mesh) {
            piece.mesh.position.set(
                (from[1] - 3.5) * 2,
                0.6,
                (from[0] - 3.5) * 2
            );
            piece.mesh.userData.row = from[0];
            piece.mesh.userData.col = from[1];
        }

        // Restore captured piece if there was one
        if (captured && captured.mesh) {
            this.scene.add(captured.mesh);
            this.pieces.push(captured.mesh);
            this.capturedPieces[captured.player].pop();
        }

        // Switch back to previous player
        this.currentPlayer = this.currentPlayer === 'marine' ? 'pirate' : 'marine';
        this.turnNumber--;

        this.updateDisplay();
        this.showMessage('Move undone', 'info');
    }

    async initThreeJS() {
        // Check if Three.js is loaded
        if (typeof THREE === 'undefined') {
            throw new Error('Three.js library not loaded. Please check your internet connection and refresh the page.');
        }
        
        console.log('🎯 Three.js version:', THREE.REVISION);
        
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);
        this.scene.fog = new THREE.Fog(0x0a0a0a, 10, 50);

        // Create camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 15, 15);
        this.camera.lookAt(0, 0, 0);

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: document.getElementById('game-canvas'),
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // No OrbitControls - camera controlled only by keyboard
        // This prevents mouse event interference with piece selection
        this.controls = null;

        // Create lights
        this.setupLighting();

        // Create particle system
        this.createParticleSystem();

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupLighting() {
        // Ambient light
        this.ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        this.scene.add(this.ambientLight);

        // Directional light (sun)
        this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.directionalLight.position.set(10, 20, 10);
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.directionalLight.shadow.camera.near = 0.5;
        this.directionalLight.shadow.camera.far = 50;
        this.directionalLight.shadow.camera.left = -20;
        this.directionalLight.shadow.camera.right = 20;
        this.directionalLight.shadow.camera.top = 20;
        this.directionalLight.shadow.camera.bottom = -20;
        this.scene.add(this.directionalLight);

        // Spot light for dramatic effect
        this.spotLight = new THREE.SpotLight(0xffd700, 0.5);
        this.spotLight.position.set(0, 25, 0);
        this.spotLight.angle = Math.PI / 6;
        this.spotLight.penumbra = 0.1;
        this.spotLight.decay = 2;
        this.spotLight.distance = 50;
        this.spotLight.castShadow = true;
        this.scene.add(this.spotLight);
    }

    createParticleSystem() {
        const particleCount = 1000;
        const particles = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount * 3; i += 3) {
            positions[i] = (Math.random() - 0.5) * 100;
            positions[i + 1] = Math.random() * 50;
            positions[i + 2] = (Math.random() - 0.5) * 100;

            colors[i] = Math.random() * 0.5 + 0.5;
            colors[i + 1] = Math.random() * 0.3 + 0.7;
            colors[i + 2] = Math.random() * 0.5 + 0.5;
        }

        particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const particleMaterial = new THREE.PointsMaterial({
            size: 0.1,
            vertexColors: true,
            transparent: true,
            opacity: 0.6
        });

        this.particleSystem = new THREE.Points(particles, particleMaterial);
        this.scene.add(this.particleSystem);
    }

    create3DBoard() {
        // Create board base
        const boardGeometry = new THREE.BoxGeometry(16, 1, 16);
        const boardMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x8B4513,
            transparent: true,
            opacity: 0.9
        });
        const board = new THREE.Mesh(boardGeometry, boardMaterial);
        board.position.y = -0.5;
        board.castShadow = true;
        board.receiveShadow = true;
        this.scene.add(board);

        // Create board squares
        this.boardSquares = [];
        for (let row = 0; row < 8; row++) {
            this.boardSquares[row] = [];
            for (let col = 0; col < 8; col++) {
                const isLight = (row + col) % 2 === 0;
                const squareGeometry = new THREE.BoxGeometry(1.8, 0.1, 1.8);
                const squareMaterial = new THREE.MeshLambertMaterial({ 
                    color: isLight ? 0xf0d9b5 : 0xb58863
                });
                const square = new THREE.Mesh(squareGeometry, squareMaterial);
                square.position.set(
                    (col - 3.5) * 2,
                    0,
                    (row - 3.5) * 2
                );
                square.userData = { row, col, isLight };
                square.castShadow = true;
                square.receiveShadow = true;
                this.scene.add(square);
                this.boardSquares[row][col] = square;
            }
        }

        // Initialize board array
        this.board = Array(8).fill().map(() => Array(8).fill(null));
        this.pieces = [];

        // Set up initial piece positions
        this.setupInitialPosition();
    }

    createPiece(player, type, row, col) {
        const pieceData = player === 'marine' ? this.marinePieces[type] : this.pirateCrews[this.selectedCrew][type];

        // Create material for a sprite (flat billboard)
        const textureLoader = new THREE.TextureLoader();
        const fallbackTexture = this.createTextTexture(pieceData.name || `${player} ${type}`);
        if (fallbackTexture && fallbackTexture.colorSpace !== undefined) {
            fallbackTexture.colorSpace = THREE.SRGBColorSpace;
        }
        const material = new THREE.SpriteMaterial({
            map: fallbackTexture,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            color: 0xffffff
        });
        
        // Resolve local sprite path deterministically
        const localPath = this.getLocalSpritePath(player, type);
        if (localPath) {
            console.log(`🖼️ Loading texture from: ${localPath}`);
            textureLoader.load(
                localPath,
                (texture) => {
                    // Ensure correct color space and visibility
                    if (texture.colorSpace !== undefined) {
                        texture.colorSpace = THREE.SRGBColorSpace;
                    }
                    material.map = texture;
                    material.opacity = 1.0;
                    material.needsUpdate = true;
                    console.log(`✅ Loaded texture for ${player} ${type} from ${localPath}`);
                },
                undefined,
                () => {
                    console.warn(`❌ Failed to load local texture: ${localPath} for ${player} ${type}. Keeping text fallback.`);
                }
            );
        }
        // Always face the camera (billboard)
        material.rotation = 0;

        // Create sprite instead of 3D geometry so the image "just sits" on the board
        const piece = new THREE.Sprite(material);
        piece.position.set(
            (col - 3.5) * 2,
            0.6,
            (row - 3.5) * 2
        );
        // Scale sprite by piece type for readability
        const sizeByType = { king: 1.25, queen: 1.2, rook: 1.1, bishop: 1.1, knight: 1.1, pawn: 0.95 };
        const spriteSize = sizeByType[type] || 1.0;
        piece.scale.set(spriteSize, spriteSize, 1);
        piece.renderOrder = 2; // draw on top of board
        // Add unique ID for debugging
        piece.userData = { player, type, row, col, id: `${player}_${type}_${row}_${col}_${Date.now()}` };
        // Sprites do not need shadows
        
        console.log(`🎭 Created piece with ID: ${piece.userData.id}`);

        this.scene.add(piece);
        this.pieces.push(piece);
        this.board[row][col] = { player, type, mesh: piece };

        return piece;
    }

    getLocalSpritePath(player, type) {
        const normalizedType = String(type).toLowerCase();
        if (player === 'marine') {
            return `/assets/marines/${normalizedType}.png`;
        }
        if (player === 'pirate' && this.selectedCrew) {
            return `/assets/crews/${this.selectedCrew}/${normalizedType}.png`;
        }
        return null;
    }

    createBoard() {
        const board = document.getElementById('chessboard');
        board.innerHTML = '';

        // Initialize board array
        this.board = Array(8).fill().map(() => Array(8).fill(null));

        // Create squares
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.className = `square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
                square.dataset.row = row;
                square.dataset.col = col;
                board.appendChild(square);
            }
        }

        // Set up initial piece positions
        this.setupInitialPosition();
    }

    setupInitialPosition() {
        // Marine pieces (bottom)
        this.createPiece('marine', 'rook', 7, 0);
        this.createPiece('marine', 'knight', 7, 1);
        this.createPiece('marine', 'bishop', 7, 2);
        this.createPiece('marine', 'queen', 7, 3);
        this.createPiece('marine', 'king', 7, 4);
        this.createPiece('marine', 'bishop', 7, 5);
        this.createPiece('marine', 'knight', 7, 6);
        this.createPiece('marine', 'rook', 7, 7);

        for (let col = 0; col < 8; col++) {
            this.createPiece('marine', 'pawn', 6, col);
        }

        // Pirate pieces will be created when crew is selected
        // Don't call createPiratePieces() here
    }

    createPiratePieces() {
        if (!this.selectedCrew) {
            console.warn('No crew selected, cannot create pirate pieces');
            return;
        }

        // Clear any existing pirate pieces first
        this.pieces.forEach(piece => {
            if (piece.userData.player === 'pirate') {
                this.scene.remove(piece);
                this.board[piece.userData.row][piece.userData.col] = null;
            }
        });
        this.pieces = this.pieces.filter(piece => piece.userData.player !== 'pirate');

        // Create new pirate pieces
        this.createPiece('pirate', 'rook', 0, 0);
        this.createPiece('pirate', 'knight', 0, 1);
        this.createPiece('pirate', 'bishop', 0, 2);
        this.createPiece('pirate', 'queen', 0, 3);
        this.createPiece('pirate', 'king', 0, 4);
        this.createPiece('pirate', 'bishop', 0, 5);
        this.createPiece('pirate', 'knight', 0, 6);
        this.createPiece('pirate', 'rook', 0, 7);

        for (let col = 0; col < 8; col++) {
            this.createPiece('pirate', 'pawn', 1, col);
        }
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        // Animate particle system
        if (this.particleSystem) {
            this.particleSystem.rotation.y += 0.001;
        }

        // Animate selected piece
        if (this.selectedPiece) {
            this.selectedPiece.rotation.y += 0.02;
            this.selectedPiece.position.y = 0.6 + Math.sin(Date.now() * 0.005) * 0.1;
        }

        // Animate spot light
        if (this.spotLight) {
            this.spotLight.position.x = Math.sin(Date.now() * 0.001) * 5;
            this.spotLight.position.z = Math.cos(Date.now() * 0.001) * 5;
        }

        // No controls to update since we removed OrbitControls
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    clearHighlights() {
        // Clear board square highlights
        this.boardSquares.forEach(row => {
            row.forEach(square => {
                const material = square.material;
                if (material.emissive) {
                    material.emissive.setHex(0x000000);
                }
            });
        });
    }

    highlightSquare(row, col, type) {
        const square = this.boardSquares[row][col];
        const material = square.material;
        
        // Use emissive for subtle glow and emissiveIntensity for clarity
        const setCyanBorder = () => {
            // Simulate a border by increasing emissive on the square edges
            material.emissive.setHex(0x00ffff);
            if (material.emissiveIntensity !== undefined) material.emissiveIntensity = 0.6;
        };

        const setRedBorder = () => {
            material.emissive.setHex(0xff4444);
            if (material.emissiveIntensity !== undefined) material.emissiveIntensity = 0.6;
        };

        const setPurpleFill = () => {
            material.emissive.setHex(0x7b61ff);
            if (material.emissiveIntensity !== undefined) material.emissiveIntensity = 0.6;
        };

        switch (type) {
            case 'selected':
                setPurpleFill();
                break;
            case 'possible-move':
                setCyanBorder();
                break;
            case 'possible-capture':
                setRedBorder();
                break;
        }
    }

    showPossibleMoves(row, col) {
        const piece = this.board[row][col];
        if (!piece) return;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.isValidMove(row, col, r, c)) {
                    const targetPiece = this.board[r][c];
                    const highlightType = targetPiece ? 'possible-capture' : 'possible-move';
                    this.highlightSquare(r, c, highlightType);
                }
            }
        }
    }

    makeMove(fromRow, fromCol, toRow, toCol, onComplete = null) {
        const piece = this.board[fromRow][fromCol];
        const targetPiece = this.board[toRow][toCol];
        
        console.log(`🚀 Making move: ${piece.player} ${piece.type} from (${fromRow},${fromCol}) to (${toRow},${toCol})`);
        console.log(`🚀 Piece mesh position before move:`, piece.mesh.position);
        console.log(`🚀 Total pieces in scene before move:`, this.pieces.length);

        // Capture piece if present
        if (targetPiece) {
            console.log(`🚀 Capturing ${targetPiece.player} ${targetPiece.type} with ID: ${targetPiece.mesh.userData.id}`);
            this.capturedPieces[targetPiece.player].push(targetPiece.type);
            this.scene.remove(targetPiece.mesh);
            this.pieces = this.pieces.filter(p => p !== targetPiece.mesh);
            console.log(`🗑️ Removed piece from scene: ${targetPiece.mesh.userData.id}`);
        }

        // Add debugging to track all pieces before animation
        const allPiecesBeforeMove = this.scene.children.filter(obj => obj.userData && obj.userData.player);
        console.log(`🚀 All pieces in scene before animation:`, allPiecesBeforeMove.map(p => `${p.userData.id} at (${p.userData.row},${p.userData.col})`));
        
        // Animate piece movement (only allow human move if it's pirate's turn)
        this.animatePieceMove(piece.mesh, fromRow, fromCol, toRow, toCol, () => {
            console.log(`🚀 Animation completed for ${piece.player} ${piece.type}`);
            console.log(`🚀 Piece mesh final position:`, piece.mesh.position);
            console.log(`🚀 Board state at old position (${fromRow},${fromCol}):`, this.board[fromRow][fromCol]);
            console.log(`🚀 Board state at new position (${toRow},${toCol}) before update:`, this.board[toRow][toCol]);
            
            // Update board data - modify the original piece object instead of creating new one
            piece.hasMoved = true;
            this.board[toRow][toCol] = piece;
            this.board[fromRow][fromCol] = null;
            piece.mesh.userData.row = toRow;
            piece.mesh.userData.col = toCol;
            
            console.log(`🚀 Board state at new position (${toRow},${toCol}) after update:`, this.board[toRow][toCol]);
            console.log(`🚀 Total pieces in scene after move:`, this.pieces.length);

            // Safety: remove any ghost sprites left behind at the from-square
            const ghosts = this.scene.children.filter(obj =>
                obj !== piece.mesh &&
                obj.userData && obj.userData.player &&
                obj.userData.player === piece.player &&
                obj.userData.type === piece.type &&
                obj.userData.row === fromRow && obj.userData.col === fromCol
            );
            if (ghosts.length) {
                console.warn(`👻 Removing ${ghosts.length} ghost piece(s) at (${fromRow},${fromCol})`);
                for (const g of ghosts) {
                    this.scene.remove(g);
                    this.pieces = this.pieces.filter(p => p !== g);
                }
            }
            
            // Add debugging to track all pieces after animation
            const allPiecesAfterMove = this.scene.children.filter(obj => obj.userData && obj.userData.player);
            console.log(`🚀 All pieces in scene after animation:`, allPiecesAfterMove.map(p => `${p.userData.id} at (${p.userData.row},${p.userData.col})`));

            // Check for pawn promotion
            if (piece.type === 'pawn' && (toRow === 0 || toRow === 7)) {
                this.promotePawn(toRow, toCol);
            }

            // Record move
            this.moveHistory.push({
                from: [fromRow, fromCol],
                to: [toRow, toCol],
                piece: piece,
                captured: targetPiece
            });

            // Switch players
            this.currentPlayer = this.currentPlayer === 'marine' ? 'pirate' : 'marine';
            this.turnNumber++;

            // Check for devil fruit spawn
            if (this.turnNumber % 7 === 0) {
                this.spawnDevilFruits();
            }

            // Update display
            this.updateDisplay();
            this.clearHighlights();

            // Check for game end
            if (this.isCheckmate()) {
                this.showMessage(`Checkmate! ${this.currentPlayer === 'marine' ? 'Pirates' : 'Marines'} win!`, 'success');
            } else if (this.isCheck()) {
                this.showMessage('Check!', 'error');
            }
            
            // Call the completion callback if provided (for AI moves)
            if (onComplete) {
                onComplete();
            }
            
            // Trigger AI move only when it's actually marine's turn after a human move
            if (this.currentPlayer === 'marine' && this.aiEnabled && !onComplete) {
                setTimeout(() => {
                    this.makeAIMove();
                }, 500); // Small delay for better UX
            }
        });
    }

    animatePieceMove(piece, fromRow, fromCol, toRow, toCol, callback) {
        const startPos = {
            x: (fromCol - 3.5) * 2,
            y: 0.6,
            z: (fromRow - 3.5) * 2
        };
        const endPos = {
            x: (toCol - 3.5) * 2,
            y: 2.6, // Lift up
            z: (toRow - 3.5) * 2
        };

        const duration = 1000; // 1 second
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function for smooth movement
            const easeProgress = 1 - Math.pow(1 - progress, 3);

            piece.position.x = startPos.x + (endPos.x - startPos.x) * easeProgress;
            piece.position.y = startPos.y + (endPos.y - startPos.y) * Math.sin(progress * Math.PI);
            piece.position.z = startPos.z + (endPos.z - startPos.z) * easeProgress;

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Set final position
                piece.position.set(endPos.x, 0.6, endPos.z);
                callback();
            }
        };

        animate();
    }

    isValidMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.board[fromRow][fromCol];
        const targetPiece = this.board[toRow][toCol];

        if (!piece) return false;
        if (targetPiece && targetPiece.player === piece.player) return false;

        const rowDiff = toRow - fromRow;
        const colDiff = toCol - fromCol;

        switch (piece.type) {
            case 'pawn':
                return this.isValidPawnMove(fromRow, fromCol, toRow, toCol);
            case 'rook':
                return this.isValidRookMove(fromRow, fromCol, toRow, toCol);
            case 'knight':
                return this.isValidKnightMove(fromRow, fromCol, toRow, toCol);
            case 'bishop':
                return this.isValidBishopMove(fromRow, fromCol, toRow, toCol);
            case 'queen':
                return this.isValidQueenMove(fromRow, fromCol, toRow, toCol);
            case 'king':
                return this.isValidKingMove(fromRow, fromCol, toRow, toCol);
            default:
                return false;
        }
    }

    isValidPawnMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.board[fromRow][fromCol];
        const direction = piece.player === 'marine' ? -1 : 1;
        const startRow = piece.player === 'marine' ? 6 : 1;
        const rowDiff = toRow - fromRow;
        const colDiff = toCol - fromCol;

        // Forward move
        if (colDiff === 0 && rowDiff === direction && !this.board[toRow][toCol]) {
            return true;
        }

        // Initial two-square move
        if (colDiff === 0 && fromRow === startRow && rowDiff === 2 * direction && 
            !this.board[fromRow + direction][fromCol] && !this.board[toRow][toCol]) {
            return true;
        }

        // Diagonal capture
        if (Math.abs(colDiff) === 1 && rowDiff === direction && this.board[toRow][toCol]) {
            return true;
        }

        return false;
    }

    isValidRookMove(fromRow, fromCol, toRow, toCol) {
        return (fromRow === toRow || fromCol === toCol) && 
               this.isPathClear(fromRow, fromCol, toRow, toCol);
    }

    isValidKnightMove(fromRow, fromCol, toRow, toCol) {
        const rowDiff = Math.abs(toRow - fromRow);
        const colDiff = Math.abs(toCol - fromCol);
        return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
    }

    isValidBishopMove(fromRow, fromCol, toRow, toCol) {
        return Math.abs(toRow - fromRow) === Math.abs(toCol - fromCol) && 
               this.isPathClear(fromRow, fromCol, toRow, toCol);
    }

    isValidQueenMove(fromRow, fromCol, toRow, toCol) {
        return this.isValidRookMove(fromRow, fromCol, toRow, toCol) || 
               this.isValidBishopMove(fromRow, fromCol, toRow, toCol);
    }

    isValidKingMove(fromRow, fromCol, toRow, toCol) {
        const rowDiff = Math.abs(toRow - fromRow);
        const colDiff = Math.abs(toCol - fromCol);
        return rowDiff <= 1 && colDiff <= 1;
    }

    isPathClear(fromRow, fromCol, toRow, toCol) {
        const rowStep = fromRow === toRow ? 0 : (toRow - fromRow) / Math.abs(toRow - fromRow);
        const colStep = fromCol === toCol ? 0 : (toCol - fromCol) / Math.abs(toCol - fromCol);

        let currentRow = fromRow + rowStep;
        let currentCol = fromCol + colStep;

        while (currentRow !== toRow || currentCol !== toCol) {
            if (this.board[currentRow][currentCol]) return false;
            currentRow += rowStep;
            currentCol += colStep;
        }

        return true;
    }


    promotePawn(row, col) {
        const piece = this.board[row][col];
        const promotionType = 'queen'; // Always promote to queen for simplicity
        
        // Remove old piece
        this.scene.remove(piece.mesh);
        this.pieces = this.pieces.filter(p => p !== piece.mesh);
        
        // Create new promoted piece
        const newPiece = this.createPiece(piece.player, promotionType, row, col);
        this.board[row][col] = { player: piece.player, type: promotionType, mesh: newPiece };
        
        this.showMessage(`${piece.player} pawn promoted to ${promotionType}!`, 'success');
    }

    spawnDevilFruits() {
        this.availableDevilFruits = [
            { type: 'gomu-gomu', piece: 'queen', name: 'Gomu Gomu no Mi' },
            { type: 'mera-mera', piece: 'knight', name: 'Mera Mera no Mi' },
            { type: 'ope-ope', piece: 'rook', name: 'Ope Ope no Mi' },
            { type: 'gora-gora', piece: 'bishop', name: 'Gora Gora no Mi' }
        ];
        this.updateDevilFruitsDisplay();
        this.showMessage('Devil Fruits have appeared! Click on a pawn and then a devil fruit to transform!', 'info');
    }

    updateDevilFruitsDisplay() {
        const container = document.getElementById('devil-fruits-container');
        container.innerHTML = '';

        this.availableDevilFruits.forEach(fruit => {
            const fruitElement = document.createElement('div');
            fruitElement.className = 'devil-fruit';
            fruitElement.style.backgroundImage = `url(${this.devilFruitSprites[fruit.type]})`;
            fruitElement.title = fruit.name;
            fruitElement.onclick = () => this.useDevilFruit(fruit);
            container.appendChild(fruitElement);
        });
    }

    useDevilFruit(fruit) {
        if (!this.selectedPiece) {
            this.showMessage('Select a pawn first!', 'error');
            return;
        }

        const pieceData = this.selectedPiece.userData;
        const piece = this.board[pieceData.row][pieceData.col];

        if (!piece || piece.type !== 'pawn') {
            this.showMessage('Only pawns can eat devil fruits!', 'error');
            return;
        }

        // Transform the pawn
        const newPiece = this.createPiece(piece.player, fruit.piece, pieceData.row, pieceData.col);
        this.board[pieceData.row][pieceData.col] = { player: piece.player, type: fruit.piece, mesh: newPiece };
        
        // Remove old piece
        this.scene.remove(piece.mesh);
        this.pieces = this.pieces.filter(p => p !== piece.mesh);

        // Remove the devil fruit
        this.availableDevilFruits = this.availableDevilFruits.filter(f => f.type !== fruit.type);
        this.updateDevilFruitsDisplay();

        this.showMessage(`${piece.player} pawn transformed into ${fruit.piece} using ${fruit.name}!`, 'success');
        this.selectedPiece = null;
        this.clearHighlights();
    }

    isCheck() {
        // Find king position
        let kingRow, kingCol;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece && piece.type === 'king' && piece.player === this.currentPlayer) {
                    kingRow = row;
                    kingCol = col;
                    break;
                }
            }
        }

        // Check if any opponent piece can attack the king
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece && piece.player !== this.currentPlayer) {
                    if (this.isValidMove(row, col, kingRow, kingCol)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    isCheckmate() {
        if (!this.isCheck()) return false;

        // Check if any move can get out of check
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece && piece.player === this.currentPlayer) {
                    for (let toRow = 0; toRow < 8; toRow++) {
                        for (let toCol = 0; toCol < 8; toCol++) {
                            if (this.isValidMove(row, col, toRow, toCol)) {
                                // Try the move
                                const originalPiece = this.board[toRow][toCol];
                                this.board[toRow][toCol] = piece;
                                this.board[row][col] = null;

                                const stillInCheck = this.isCheck();

                                // Undo the move
                                this.board[row][col] = piece;
                                this.board[toRow][toCol] = originalPiece;

                                if (!stillInCheck) {
                                    return false;
                                }
                            }
                        }
                    }
                }
            }
        }

        return true;
    }

    undoMove() {
        if (this.moveHistory.length === 0) return;

        const lastMove = this.moveHistory.pop();
        const { from, to, piece, captured } = lastMove;

        // Restore the moved piece
        this.board[from[0]][from[1]] = piece;
        this.board[to[0]][to[1]] = captured;

        // Update display
        this.updateSquare(from[0], from[1]);
        this.updateSquare(to[0], to[1]);

        // Switch back to previous player
        this.currentPlayer = this.currentPlayer === 'marine' ? 'pirate' : 'marine';
        this.turnNumber--;

        this.updateDisplay();
        this.showMessage('Move undone', 'info');
    }

    updateDisplay() {
        document.getElementById('current-player').textContent = 
            this.currentPlayer === 'marine' ? 'Marines' : 'Pirates';
        document.getElementById('turn-number').textContent = this.turnNumber;
        document.getElementById('devil-fruit-turns').textContent = 7 - (this.turnNumber % 7);

        // Update captured pieces display
        this.updateCapturedPiecesDisplay();
    }

    updateCapturedPiecesDisplay() {
        const marineContainer = document.getElementById('captured-marines');
        const pirateContainer = document.getElementById('captured-pirates');

        marineContainer.innerHTML = '';
        pirateContainer.innerHTML = '';

        this.capturedPieces.marine.forEach(pieceType => {
            const pieceElement = document.createElement('div');
            pieceElement.className = 'captured-piece marine';
            const pieceData = this.marinePieces[pieceType];
            pieceElement.style.backgroundImage = `url(${pieceData.texture})`;
            marineContainer.appendChild(pieceElement);
        });

        if (this.selectedCrew) {
            this.capturedPieces.pirate.forEach(pieceType => {
                const pieceElement = document.createElement('div');
                pieceElement.className = 'captured-piece pirate';
                const pieceData = this.pirateCrews[this.selectedCrew][pieceType];
                pieceElement.style.backgroundImage = `url(${pieceData.texture})`;
                pirateContainer.appendChild(pieceElement);
            });
        }
    }

    showMessage(message, type = 'info') {
        const messageElement = document.getElementById('game-message');
        
        if (!messageElement) {
            console.warn('Game message element not found');
            return;
        }
        
        // Clear any existing timeout
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
        }
        
        messageElement.textContent = message;
        messageElement.className = `game-message ${type}`;
        messageElement.style.display = 'flex'; // Make sure it's visible when showing
        
        console.log(`📝 Showing message: "${message}" (type: ${type})`);

        // Set new timeout and store reference
        this.messageTimeout = setTimeout(() => {
            if (messageElement) {
                messageElement.textContent = '';
                messageElement.className = 'game-message';
                messageElement.style.display = 'none'; // Hide when timeout expires
            }
            this.messageTimeout = null;
        }, 3000);
    }

    clearMessage() {
        console.log('🔥 Clearing message...');
        const messageElement = document.getElementById('game-message');
        if (messageElement) {
            console.log('🔥 Message element found, clearing content');
            messageElement.textContent = '';
            messageElement.className = 'game-message';
            messageElement.style.display = 'none'; // Explicitly hide the element
        } else {
            console.log('🔥 Message element not found');
        }
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
            console.log('🔥 Cleared message timeout');
        }
    }

    // Special function for temporary blocking messages (shorter duration)
    showTemporaryMessage(message, type = 'info', duration = 1500) {
        const messageElement = document.getElementById('game-message');
        
        if (!messageElement) {
            console.warn('Game message element not found');
            return;
        }
        
        // Clear any existing timeout
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
        }
        
        messageElement.textContent = message;
        messageElement.className = `game-message ${type}`;
        messageElement.style.display = 'flex';
        
        console.log(`⚡ Showing temporary message: "${message}" (duration: ${duration}ms)`);

        // Set shorter timeout for temporary messages
        this.messageTimeout = setTimeout(() => {
            if (messageElement) {
                messageElement.textContent = '';
                messageElement.className = 'game-message';
                messageElement.style.display = 'none';
            }
            this.messageTimeout = null;
        }, duration);
    }

    resetGame() {
        // Clear all pieces from scene
        this.pieces.forEach(piece => {
            this.scene.remove(piece);
        });
        this.pieces = [];

        // Reset game state
        this.board = Array(8).fill().map(() => Array(8).fill(null));
        this.currentPlayer = 'pirate';  // Pirates go first
        this.selectedPiece = null;
        this.turnNumber = 1;
        this.moveHistory = [];
        this.capturedPieces = { marine: [], pirate: [] };
        this.availableDevilFruits = [];
        this.devilFruitCounter = 7;
        this.aiThinking = false;

        // Clear highlights
        this.clearHighlights();

        // Recreate marine pieces only
        this.setupInitialPosition();
        
        // Recreate pirate pieces if crew is selected
        if (this.selectedCrew) {
            this.createPiratePieces();
        }
        
        this.updateDisplay();
        this.spawnDevilFruits();
        this.showMessage('New game started! Pirates go first.', 'success');
    }
}

// Initialize the game when the script loads (Three.js is already loaded)
(async () => {
    try {
        console.log('🚢 Starting One Piece 3D Chess...');
        const game = new OnePiece3DChess();
        await game.init();
        console.log('✅ Game initialized successfully!');
    } catch (error) {
        console.error('❌ Error initializing game:', error);
        // Show error message to user
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.innerHTML = `
                <div class="loading-content">
                    <h1>One Piece 3D Chess</h1>
                    <p style="color: #ff6b6b;">Error loading game: ${error.message}</p>
                    <p>Please refresh the page or check your browser console.</p>
                    <button onclick="location.reload()" style="padding: 10px 20px; background: #ff6b35; color: white; border: none; border-radius: 5px; cursor: pointer;">Reload Page</button>
                </div>
            `;
        }
    }
})();
