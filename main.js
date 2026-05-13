import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// --- 設定・状態 ---
let STAGE_SIZE = 24; 
let GRID_COUNT = 10; 
const MAX_LIFE = 5;
const BALL_RADIUS = 0.5;
let attempts = 0;
let isResetting = false;
let isShowingMessage = false; 
let isWaitingClick = true;
let currentLevel = 'normal';
let controlMode = 'mouse';
let isProcessingFall = false;
let warpSafetyTimer = 0; 

let movingWalls = [];
let speedPanels = [];
let warps = [];
let holePoints = []; 
let isWarping = false;

const lifeContainer = document.getElementById('ui');
const messageOverlay = document.getElementById('message-overlay');
const clickPrompt = document.getElementById('click-prompt');
const sizeSelect = document.getElementById('size-select');
const levelSelect = document.getElementById('level-select');
const inputSelect = document.getElementById('input-select');
const guideText = document.getElementById('guide-text');
const regenButton = document.getElementById('regen-button');

// --- UI関数 ---
function showMessage(type, callback = null) {
    if(!messageOverlay || isShowingMessage) return;
    isShowingMessage = true;
    messageOverlay.classList.remove('msg-anim');
    void messageOverlay.offsetWidth; 
    messageOverlay.className = 'msg-window msg-anim ' + type;
    messageOverlay.innerText = type === 'goal' ? "GOAL!!" : type === 'fall' ? "FALL..." : "NEW MAZE";
    messageOverlay.style.display = 'block';
    clickPrompt.style.display = 'none'; 
    setTimeout(() => { 
        messageOverlay.style.display = 'none'; 
        messageOverlay.classList.remove('msg-anim');
        isShowingMessage = false;
        if (callback) callback(); 
        updateGuide();
    }, 1200);
}

function updateLifeDisplay() {
    if(!lifeContainer) return;
    lifeContainer.innerHTML = '';
    for (let i = 0; i < MAX_LIFE; i++) {
        const heart = document.createElement('div');
        heart.className = 'heart' + (i >= (MAX_LIFE - attempts) ? ' lost' : '');
        lifeContainer.appendChild(heart);
    }
}

function updateGuide() {
    if (isShowingMessage) { clickPrompt.style.display = 'none'; return; }
    
    if (controlMode === 'key') {
        guideText.innerHTML = isWaitingClick ? '<span class="key">WAITING...</span>' : '<span class="key">HOLD ↑↓←→</span> TILT BOARD';
        clickPrompt.innerHTML = '<span class="text-blink">PRESS ARROW KEY</span>';
    } else {
        guideText.innerHTML = isWaitingClick ? '<span class="key">WAITING...</span>' : '<span class="key">MOUSE MOVE</span> TILT BOARD';
        clickPrompt.innerHTML = '<span class="text-blink">CLICK TO START</span>';
    }
    clickPrompt.style.display = isWaitingClick ? 'block' : 'none';
}

// --- 物理設定 ---
const world = new CANNON.World();
world.gravity.set(0, -35, 0); 
world.solver.iterations = 20;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfef6e4); 
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xfef6e4, 0.6); scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
sunLight.position.set(10, 30, 10); sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048); scene.add(sunLight);

const ballMaterial = new CANNON.Material('ball');
const floorMaterial = new CANNON.Material('floor');
const wallMaterial = new CANNON.Material('wall');

world.addContactMaterial(new CANNON.ContactMaterial(floorMaterial, ballMaterial, { friction: 0.1, restitution: 0.1 }));
world.addContactMaterial(new CANNON.ContactMaterial(wallMaterial, ballMaterial, { friction: 0.05, restitution: 0.4 }));

let floorBody, floorMesh = new THREE.Group(); scene.add(floorMesh);
const ballBody = new CANNON.Body({ 
    mass: 2.5, shape: new CANNON.Sphere(BALL_RADIUS), material: ballMaterial,
    linearDamping: 0.1, angularDamping: 0.1
});
world.addBody(ballBody);
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 32), new THREE.MeshStandardMaterial({ color: 0xf582ae }));
ballMesh.castShadow = true; scene.add(ballMesh);

let step, goalLocalPos;
const wallSideMat = new THREE.MeshStandardMaterial({ color: 0xf3d2c1 }); 
const wallTopMat = new THREE.MeshStandardMaterial({ color: 0x172c66 });
const moveWallTopMat = new THREE.MeshStandardMaterial({ color: 0xf582ae });

function createWall(x, z, w, h, d, isVertical = false) {
    const overlap = 0.15; 
    floorBody.addShape(new CANNON.Box(new CANNON.Vec3(w/2, h, d/2)), new CANNON.Vec3(x, h/2, z));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(isVertical ? w : w + overlap, h, isVertical ? d + overlap : d), [wallSideMat, wallSideMat, wallTopMat, wallSideMat, wallSideMat, wallSideMat]);
    mesh.position.set(x, h/2 - 0.01, z); mesh.receiveShadow = true; floorMesh.add(mesh);
}

function createFloorPanel(x, z, size, hasHole) {
    const cHalfHeight = 0.1; 
    if (!hasHole) {
        floorBody.addShape(new CANNON.Box(new CANNON.Vec3(size/2, cHalfHeight, size/2)), new CANNON.Vec3(x, -cHalfHeight, z));
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, 0.2, size), wallSideMat);
        mesh.position.set(x, 0, z); mesh.receiveShadow = true; floorMesh.add(mesh);
    } else {
        const holeSize = 1.6;
        const th = (size - holeSize) / 2, off = (size - th) / 2;
        [{w:size, d:th, px:0, pz:off}, {w:size, d:th, px:0, pz:-off}, {w:th, d:holeSize, px:off, pz:0}, {w:th, d:holeSize, px:-off, pz:0}].forEach(p => {
            floorBody.addShape(new CANNON.Box(new CANNON.Vec3(p.w/2, cHalfHeight, p.d/2)), new CANNON.Vec3(x+p.px, -cHalfHeight, z+p.pz));
            const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.2, p.d), wallSideMat);
            m.position.set(x+p.px, 0, z+p.pz); m.receiveShadow = true; floorMesh.add(m);
        });
        holePoints.push(new THREE.Vector3(x, 0, z)); 
    }
}

function generateMaze() {
    if (floorBody) world.removeBody(floorBody);
    
    floorBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: floorMaterial });
    world.addBody(floorBody);
    
    while(floorMesh.children.length > 0) floorMesh.remove(floorMesh.children[0]);
    movingWalls.forEach(w => world.removeBody(w.body));
    movingWalls = []; speedPanels = []; warps = []; holePoints = [];
    
    step = STAGE_SIZE / GRID_COUNT;
    const s = STAGE_SIZE;
    createWall(0, (s+1)/2, s+2, 1.8, 1, false); createWall(0, -(s+1)/2, s+2, 1.8, 1, false);
    createWall((s+1)/2, 0, 1, 1.8, s, true); createWall(-(s+1)/2, 0, 1, 1.8, s, true);

    let objectMap = Array(GRID_COUNT).fill().map(() => Array(GRID_COUNT).fill(false)); 
    let pathRes = Array(GRID_COUNT).fill().map(() => Array(GRID_COUNT).fill(false));
    let forbiddenWallMap = Array(GRID_COUNT).fill().map(() => Array(GRID_COUNT).fill(0));

    let ci = 0, cj = GRID_COUNT - 1; 
    pathRes[ci][cj] = true;
    while (ci < GRID_COUNT - 1 || cj > 0) {
        let prevI = ci, prevJ = cj;
        if (ci < GRID_COUNT - 1 && cj > 0) { if (Math.random() > 0.5) ci++; else cj--; }
        else if (ci < GRID_COUNT - 1) ci++; else cj--;
        pathRes[ci][cj] = true;
        if (ci !== prevI) forbiddenWallMap[Math.min(ci, prevI)][cj] |= 1; 
        if (cj !== prevJ) forbiddenWallMap[ci][Math.max(cj, prevJ)] |= 2; 
    }

    for (let i = 0; i < GRID_COUNT; i++) {
        for (let j = 0; j < GRID_COUNT; j++) {
            const x = -s/2+step/2+i*step, z = -s/2+step/2+j*step;
            const isS = (i<=1 && j>=GRID_COUNT-2), isG = (i>=GRID_COUNT-2 && j<=1);
            if(isS || isG) objectMap[i][j] = true;
            let hasH = !isS && !isG && !pathRes[i][j] && Math.random() < 0.15;
            if(hasH) objectMap[i][j] = true;
            createFloorPanel(x, z, step, hasH);
            if (!isS && !isG && !hasH && Math.random() < 0.7) {
                if (Math.random() > 0.5) {
                    if (i < GRID_COUNT - 1 && !(forbiddenWallMap[i][j] & 1)) createWall(x + step/2, z, 0.4, 1.3, step, true);
                } else {
                    if (j > 0 && !(forbiddenWallMap[i][j] & 2)) createWall(x, z - step/2, step, 1.3, 0.4, false);
                }
            }
        }
    }

    const placeGimmickBalanced = (count, type) => {
        let placed = 0;
        let attempts = 0;
        while (placed < count && attempts < 100) {
            attempts++;
            let i = Math.floor(Math.random() * (GRID_COUNT - 2)) + 1;
            let j = Math.floor(Math.random() * (GRID_COUNT - 2)) + 1;
            if (objectMap[i][j]) continue;
            if (type === 'speed' && !pathRes[i][j]) continue;
            let near = false;
            for(let di=-1; di<=1; di++) for(let dj=-1; dj<=1; dj++) {
                if (objectMap[i+di][j+dj]) near = true;
            }
            if (near && attempts < 50) continue; 
            const x = -s/2+step/2+i*step, z = -s/2+step/2+j*step;
            if (type === 'speed') {
                const m = new THREE.Mesh(new THREE.PlaneGeometry(step*0.7, step*0.7), new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffa500, emissiveIntensity: 0.8 }));
                m.rotation.x = -Math.PI/2; m.position.set(x, 0.11, z); floorMesh.add(m);
                speedPanels.push(new THREE.Vector3(x, 0, z));
            } else if (type === 'warp') {
                return {i, j, x, z}; 
            }
            objectMap[i][j] = true;
            placed++;
        }
    };

    let w1 = placeGimmickBalanced(1, 'warp');
    let w2 = placeGimmickBalanced(1, 'warp');
    if (w1 && w2) {
        const warpMat = new THREE.MeshStandardMaterial({ color: 0x9370db, emissive: 0x9370db, emissiveIntensity: 1.5, transparent: true, opacity: 0.8 });
        const m1 = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.15, 16, 32), warpMat), m2 = m1.clone();
        m1.rotation.x = m2.rotation.x = Math.PI/2;
        const p1 = new THREE.Vector3(w1.x, 0.5, w1.z), p2 = new THREE.Vector3(w2.x, 0.5, w2.z);
        m1.position.copy(p1); m2.position.copy(p2); floorMesh.add(m1, m2);
        warps.push({ a: p1, b: p2, meshA: m1, meshB: m2, lastUsed: 0 });
    }
    placeGimmickBalanced(currentLevel === 'hard' ? 6 : 4, 'speed');

    const mWallMats = [wallSideMat, wallSideMat, moveWallTopMat, wallSideMat, wallSideMat, wallSideMat];
    let mCount = currentLevel === 'hard' ? 35 : 20;
    let mPlaced = 0;
    let mAttempts = 0;
    while (mPlaced < mCount && mAttempts < 200) {
        mAttempts++;
        let i = Math.floor(Math.random()*(GRID_COUNT-2))+1, j = Math.floor(Math.random()*(GRID_COUNT-2))+1;
        if (objectMap[i][j] || (forbiddenWallMap[i][j] & 1) || (forbiddenWallMap[i][j] & 2)) continue;
        const isV = Math.random()>0.5, axis = (Math.random()>0.5) ? 'z' : 'x';
        let x = -s/2+step/2+i*step, z = -s/2+step/2+j*step;
        if ((isV && axis === 'z') || (!isV && axis === 'x')) { if (isV) x -= step/2; else z -= step/2; }
        const w = isV ? 0.4 : step*0.8, d = isV ? step*0.8 : 0.4;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), mWallMats); floorMesh.add(mesh);
        const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w*0.8/2, 1.5, d*0.8/2)), material: wallMaterial, type: CANNON.Body.KINEMATIC });
        world.addBody(body);
        movingWalls.push({ mesh, body, baseX:x, baseZ:z, offset:Math.random()*10, axis });
        objectMap[i][j] = true;
        mPlaced++;
    }

    goalLocalPos = new THREE.Vector3(s/2-step/2, 0.11, -s/2+step/2);
    const g = new THREE.Mesh(new THREE.BoxGeometry(step, 0.1, step), new THREE.MeshStandardMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 }));
    g.position.copy(goalLocalPos); floorMesh.add(g);
}

// 角度・入力状態の管理
let rotX = 0, rotZ = 0, targetRotX = 0, targetRotZ = 0; 
const currentMouse = { x: 0, y: 0 }, baseMouse = { x: 0, y: 0 };
// ★ キーの長押し状態を管理するオブジェクト
const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

function resetGame(full) {
    isResetting = true; isWarping = false; isProcessingFall = false;
    warpSafetyTimer = 0;
    
    // 角度とキー状態リセット
    rotX = 0; rotZ = 0; targetRotX = 0; targetRotZ = 0;
    keys.ArrowUp = false; keys.ArrowDown = false; keys.ArrowLeft = false; keys.ArrowRight = false;

    world.removeBody(ballBody);
    
    if (full) { 
        STAGE_SIZE = parseInt(sizeSelect.value); GRID_COUNT = STAGE_SIZE === 12 ? 6 : (STAGE_SIZE === 24 ? 10 : 14);
        attempts = 0; generateMaze(); camera.position.set(0, STAGE_SIZE * 1.1, 0); camera.lookAt(0, 0, 0);
    }
    
    updateLifeDisplay(); 
    floorBody.quaternion.set(0,0,0,1); floorMesh.quaternion.set(0,0,0,1);
    
    isWaitingClick = true; 
    updateGuide();
    
    ballBody.position.set(-STAGE_SIZE/2+step, 2.0, STAGE_SIZE/2-step); 
    ballBody.velocity.set(0,0,0); ballBody.angularVelocity.set(0,0,0);
    ballMesh.position.copy(ballBody.position);
    
    world.addBody(ballBody);
    setTimeout(() => { isResetting = false; }, 100);
}

// ★ キーを押した時の処理（フラグをONにする）
window.addEventListener('keydown', (e) => { 
    if(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    if (e.code === 'Space') { resetGame(false); return; }
    
    if (isResetting || isShowingMessage || isProcessingFall || isWarping) return;

    if (controlMode === 'key') {
        if (isWaitingClick && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
            isWaitingClick = false; updateGuide();
        }
        if (keys.hasOwnProperty(e.code)) {
            keys[e.code] = true;
        }
    }
});

// ★ キーを離した時の処理（フラグをOFFにする）
window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.code)) {
        keys[e.code] = false;
    }
});

window.addEventListener('mousemove', (e) => { 
    currentMouse.x = (e.clientX/window.innerWidth)*2-1; currentMouse.y = -(e.clientY/window.innerHeight)*2+1; 
});

window.addEventListener('mousedown', (e) => {
    if (e.target.closest('#right-ui-container') || e.target.tagName === 'SELECT' || isShowingMessage) return;
    if (controlMode === 'mouse' && isWaitingClick) {
        baseMouse.x = currentMouse.x; baseMouse.y = currentMouse.y; 
        isWaitingClick = false; updateGuide();
    }
});

[sizeSelect, levelSelect, inputSelect].forEach(sel => {
    sel.addEventListener('change', () => {
        if(sel === sizeSelect || sel === levelSelect) {
            currentLevel = levelSelect.value;
            showMessage("new-maze", () => resetGame(true));
        } else {
            controlMode = inputSelect.value;
            resetGame(false);
        }
        sel.blur();
    });
});
regenButton.addEventListener('click', () => showMessage("new-maze", () => resetGame(true)));

function animate() {
    requestAnimationFrame(animate);
    if (isResetting || isShowingMessage) { renderer.render(scene, camera); return; }
    
    world.step(1/60);
    const time = Date.now() * 0.001;
    if (warpSafetyTimer > 0) warpSafetyTimer -= 1/60; 

    movingWalls.forEach(w => {
        const targetO = Math.sin(time + w.offset) * (step * 0.4);
        const tx = w.axis === 'x' ? w.baseX + targetO : w.baseX, tz = w.axis === 'z' ? w.baseZ + targetO : w.baseZ;
        const localPos = new CANNON.Vec3(tx, 0.6, tz);
        floorBody.quaternion.vmult(localPos, w.body.position);
        w.body.quaternion.copy(floorBody.quaternion);
        w.mesh.position.set(tx, 0.6, tz);
    });
    
    warps.forEach(w => {
        const f = Math.sin(time * 3) * 0.2; w.meshA.position.y = 0.5+f; w.meshB.position.y = 0.5+f;
        w.meshA.rotation.z += 0.03; w.meshB.rotation.z += 0.03;
    });
    
    const bpl = floorMesh.worldToLocal(ballMesh.position.clone());
    
    if (!isProcessingFall) {
        holePoints.forEach(hp => {
            const dx = Math.abs(bpl.x - hp.x), dz = Math.abs(bpl.z - hp.z);
            if (dx < 0.75 && dz < 0.75 && bpl.y > -1.0) {
                ballBody.velocity.y -= 2.5; 
                ballBody.velocity.x += (hp.x - bpl.x) * 0.5;
                ballBody.velocity.z += (hp.z - bpl.z) * 0.5;
            }
        });
    }

    speedPanels.forEach(p => { if (bpl.distanceTo(p) < 0.8) ballBody.applyImpulse(new CANNON.Vec3(ballBody.velocity.x * 0.1, 0, ballBody.velocity.z * 0.1)); });
    
    warps.forEach(w => {
        if (isWarping || Date.now() - w.lastUsed < 2500) return;
        let t = bpl.distanceTo(w.a) < 0.9 ? w.b : (bpl.distanceTo(w.b) < 0.9 ? w.a : null);
        if (t) {
            isWarping = true; const dest = floorMesh.localToWorld(t.clone());
            ballBody.velocity.set(0,0,0); ballBody.angularVelocity.set(0,0,0); ballBody.position.set(dest.x, 1.2, dest.z);
            ballBody.applyImpulse(new CANNON.Vec3(0, 8, 0)); w.lastUsed = Date.now();
            warpSafetyTimer = 0.5; 
            setTimeout(() => { isWarping = false; }, 800);
        }
    });
    
    if (!isWaitingClick && !isWarping && !isProcessingFall) {
        if (controlMode === 'mouse') {
            targetRotX = -(currentMouse.y - baseMouse.y) * 0.6;
            targetRotZ = -(currentMouse.x - baseMouse.x) * 0.6;
        } else if (controlMode === 'key') {
            // ★ キーが押されている間、毎フレーム少しずつ目標角度を更新する（滑らかな長押し対応）
            const keyStep = 0.015;
            if (keys.ArrowUp) targetRotX -= keyStep;
            if (keys.ArrowDown) targetRotX += keyStep;
            if (keys.ArrowLeft) targetRotZ += keyStep;
            if (keys.ArrowRight) targetRotZ -= keyStep;
        }
        
        targetRotX = Math.max(-0.4, Math.min(0.4, targetRotX));
        targetRotZ = Math.max(-0.4, Math.min(0.4, targetRotZ));

        rotX += (targetRotX - rotX) * 0.15;
        rotZ += (targetRotZ - rotZ) * 0.15;
    }
    
    rotX = Math.max(-0.4, Math.min(0.4, rotX)); rotZ = Math.max(-0.4, Math.min(0.4, rotZ));
    floorBody.quaternion.setFromEuler(rotX, 0, rotZ); floorMesh.quaternion.copy(floorBody.quaternion);
    ballMesh.position.copy(ballBody.position); ballMesh.quaternion.copy(ballBody.quaternion);
    
    if (Math.abs(bpl.x - goalLocalPos.x) < step/2.5 && Math.abs(bpl.z - goalLocalPos.z) < step/2.5 && bpl.y > -0.5) { 
        showMessage("goal", () => resetGame(true)); return; 
    }
    
    if (!isProcessingFall && warpSafetyTimer <= 0) { 
        const outOfBounds = Math.abs(bpl.x) > STAGE_SIZE/2 + 1 || Math.abs(bpl.z) > STAGE_SIZE/2 + 1;
        if (bpl.y < -8.0 || (bpl.y < -1.5 && outOfBounds)) { 
            isProcessingFall = true;
            attempts++; 
            if (attempts >= MAX_LIFE) { showMessage("fall", () => resetGame(true)); }
            else { showMessage("fall", () => resetGame(false)); }
            return; 
        }
    }
    renderer.render(scene, camera);
}
generateMaze(); resetGame(true); animate();