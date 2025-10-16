let scene, camera, renderer, sphere;
let objects = [];
let raycaster, mouse;
let isDragging = false;
let hasDragged = false; // Track if user has dragged since mousedown
let previousMousePosition = { x: 0, y: 0 };
let dragStartQuaternion = new THREE.Quaternion();
let dragStartMouseNDC = new THREE.Vector2();
let starsLoaded = false;
let starLabels = []; // Store all star labels with their magnitude info
let objectLabels = []; // Store picture object labels
let picturesVisible = true; // Track picture visibility state

// Touch support variables
let touchStartDistance = 0;
let touchStartFov = 75;

// Pictures array - will be populated from external file
let pictures = [];

function init() {
    // Scene setup
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    // Create celestial sphere with stars
    const starGeometry = new THREE.SphereGeometry(50, 64, 64);
    const starMaterial = new THREE.MeshBasicMaterial({
        color: 0x000033,
        side: THREE.BackSide
    });
    sphere = new THREE.Mesh(starGeometry, starMaterial);
    scene.add(sphere);

    // Add random stars (will be replaced when CSV is loaded)
    //addStars();
    
    // Try to load star catalog
    loadStarCatalog();

    // Add celestial grid
    addCelestialGrid();

    // Raycaster for object selection
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Load pictures from external file
    loadPictures();

    // Event listeners
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('wheel', onWheel);
    renderer.domElement.addEventListener('click', onClick);
    
    // Touch event listeners for mobile
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd);
    
    window.addEventListener('resize', onWindowResize);

    animate();
}

async function loadPictures() {
    const picturesUrl = './pictures.json';
    try {
        const response = await fetch(picturesUrl);
        if (!response.ok) {
            console.error('Could not load pictures from:', picturesUrl);
            console.log('Using empty pictures array.');
            return;
        }
        pictures = await response.json();
        console.log(`Successfully loaded ${pictures.length} pictures from file`);
        
        // Add pictures to scene
        pictures.forEach(obj => {
            addCelestialObject(obj.name, obj.ra, obj.dec, obj.img);
        });
        
        // Update the object list UI
        updateObjectList();
    } catch (error) {
        console.error('Error loading pictures file:', error.message);
        console.log('Using empty pictures array.');
    }
}

function addStars() {
    const starVertices = [];
    for (let i = 0; i < 1000; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const r = 45;
        
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);
        
        starVertices.push(x, y, z);
    }
    
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1 });
    const stars = new THREE.Points(starGeometry, starMaterial);
    stars.name = 'randomStars';
    scene.add(stars);
}

async function loadStarCatalog() {
    const catalogUrl = './hyg_v42.csv';
    try {
        const response = await fetch(catalogUrl);
        if (!response.ok) {
            console.log('Could not load star catalog from default URL. Using random stars instead.');
            return;
        }
        const csvText = await response.text();
        parseStarCatalog(csvText);
    } catch (error) {
        console.log('Star catalog not available, using random stars:', error.message);
    }
}

function parseStarCatalog(csvText) {
    // Remove old random stars if they exist
    const oldStars = scene.getObjectByName('randomStars');
    if (oldStars) scene.remove(oldStars);
    
    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    
    console.log('CSV Headers found:', headers.join(', '));
    
    // Find column indices - try multiple possible column names
    const raIdx = headers.findIndex(h => h === 'ra' || h === 'rarad' || h === 'ra_rad');
    const decIdx = headers.findIndex(h => h === 'dec' || h === 'decrad' || h === 'dec_rad');
    const magIdx = headers.findIndex(h => h === 'mag' || h === 'v' || h === 'vmag' || h === 'absmag');
    const nameIdx = 6; // Column 7 (0-indexed as 6) contains proper names
    
    console.log(`Found columns - RA index: ${raIdx}, Dec index: ${decIdx}, Mag index: ${magIdx}, Name index: ${nameIdx}`);
    
    if (raIdx === -1 || decIdx === -1 || magIdx === -1) {
        console.error('CSV missing required columns. Available headers:', headers);
        console.error('Need columns for: right ascension (ra/rarad), declination (dec/decrad), and magnitude (mag/v/vmag)');
        return;
    }
    
    const starVertices = [];
    const starColors = [];
    const starSizes = [];
    const starMagnitudes = []; // Store magnitudes for brightness calculation
    const namedStars = []; // Store named stars for later processing
    
    // Determine if RA/Dec are in radians or hours/degrees
    let isRadians = headers[raIdx].includes('rad');
    
    // Only load stars brighter than magnitude 6.5 (visible to naked eye)
    let starCount = 0;
    for (let i = 1; i < lines.length && starCount < 10000; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const cols = line.split(',').map(c => c.trim().replace(/['"]/g, ''));
        let ra = parseFloat(cols[raIdx]);
        let dec = parseFloat(cols[decIdx]);
        const mag = parseFloat(cols[magIdx]);
        const name = cols[nameIdx] || ''; // Get the common name from column 7

        if (isNaN(ra) || isNaN(dec) || isNaN(mag) || mag > 6.5) continue;
        
        // Convert radians to hours/degrees if needed
        if (isRadians) {
            ra = ra * 12 / Math.PI; // radians to hours
            dec = dec * 180 / Math.PI; // radians to degrees
        }
        
        // Convert RA (hours) and Dec (degrees) to position
        const pos = raDecToCartesian(ra, dec, 45);
        starVertices.push(pos.x, pos.y, pos.z);
        
        // Brightness: brighter stars (lower magnitude) are larger
        const brightness = Math.pow(2.512, (6.5 - mag) / 2.5);
        starSizes.push(brightness * 1.0);
        
        // Store magnitude for opacity calculation in shader
        starMagnitudes.push(mag);
        
        // Color: white for now (could add spectral color later)
        starColors.push(1, 1, 1);
        starCount++;
        
        // Store named stars
        if (name && name.length > 0) {
            namedStars.push({ name: name, pos: pos, magnitude: mag });
        }
    }
    
    if (starVertices.length > 0) {
        const starGeometry = new THREE.BufferGeometry();
        starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
        starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
        starGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));
        starGeometry.setAttribute('magnitude', new THREE.Float32BufferAttribute(starMagnitudes, 1));
        
        const starMaterial = new THREE.ShaderMaterial({
            uniforms: {
                fov: { value: camera.fov }
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                attribute float magnitude;
                uniform float fov;
                varying vec3 vColor;
                varying float vBrightness;
                void main() {
                    vColor = color;
                    
                    // Calculate brightness based on magnitude
                    // Magnitude 0-1: full brightness (1.0)
                    // Magnitude 1-4: scale from 1.0 to 0.4
                    // Magnitude 4-6.5: scale from 0.4 to 0.15
                    float brightness;
                    if (magnitude < 1.0) {
                        brightness = 1.0;
                    } else if (magnitude < 4.0) {
                        brightness = 1.0 - (magnitude - 1.0) / 3.0 * 0.6; // 1.0 to 0.4
                    } else {
                        brightness = 0.4 - (magnitude - 4.0) / 2.5 * 0.25; // 0.4 to 0.15
                    }
                    vBrightness = brightness;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    
                    // Scale size logarithmically based on FOV (zoom level)
                    // Lower FOV = more zoomed in = larger stars
                    float zoomFactor = log(90.0 / fov) * 0.5 + 1.0;
                    gl_PointSize = size * zoomFactor;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vBrightness;
                void main() {
                    // Create circular points
                    vec2 center = gl_PointCoord - vec2(0.5);
                    float dist = length(center);
                    if (dist > 0.5) discard;
                    
                    // Soft edge for anti-aliasing
                    float alpha = smoothstep(0.5, 0.4, dist);
                    
                    // Apply brightness based on magnitude
                    gl_FragColor = vec4(vColor, alpha * vBrightness);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        
        const stars = new THREE.Points(starGeometry, starMaterial);
        stars.name = 'catalogStars';
        stars.renderOrder = 1;  // Render stars after labels
        
        // Store reference to material for zoom updates
        window.starMaterial = starMaterial;
        
        // Add labels first
        namedStars.forEach(star => {
            const label = addTextLabel(star.name, star.pos.x, star.pos.y - 0.8, star.pos.z, 0.5);
            starLabels.push({ 
                label: label, 
                magnitude: star.magnitude,
                basePos: { x: star.pos.x, y: star.pos.y, z: star.pos.z }
            });
        });
        
        // Add stars after labels
        scene.add(stars);
        
        // Update label visibility based on initial zoom
        updateLabelVisibility(camera.fov);
        
        starsLoaded = true;
        console.log(`Successfully loaded ${starVertices.length / 3} stars from catalog`);
    }
}

function addCelestialGrid() {
    const radius = 40;
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.5 });
    
    // Right Ascension circles (longitude lines)
    for (let ra = 0; ra < 24; ra++) {
        const points = [];
        for (let dec = -90; dec <= 90; dec += 5) {
            const pos = raDecToCartesian(ra, dec, radius);
            points.push(new THREE.Vector3(pos.x, pos.y, pos.z));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, gridMaterial);
        scene.add(line);
        
        // Add labels every 2 hours along the equator
        if (ra % 2 === 0) {
            const labelPos = raDecToCartesian(ra, 0, radius + 2);
            addTextLabel(`${ra}h`, labelPos.x, labelPos.y, labelPos.z, 2);
        }
    }
    
    // Declination circles (latitude lines)
    for (let dec = -75; dec <= 75; dec += 15) {
        const points = [];
        for (let ra = 0; ra <= 24.1; ra += 0.1) {
            const pos = raDecToCartesian(ra, dec, radius);
            points.push(new THREE.Vector3(pos.x, pos.y, pos.z));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, gridMaterial);
        scene.add(line);
        
        // Add labels at RA 0h
        if (dec !== 0) {
            const labelPos = raDecToCartesian(0, dec, radius + 2);
            addTextLabel(`${dec > 0 ? '+' : ''}${dec}°`, labelPos.x, labelPos.y, labelPos.z, 2);
        }
    }
    
    // Celestial equator (brighter)
    const equatorMaterial = new THREE.LineBasicMaterial({ color: 0x4a9eff, transparent: true, opacity: 0.7 });
    const equatorPoints = [];
    for (let ra = 0; ra <= 24.1; ra += 0.1) {
        const pos = raDecToCartesian(ra, 0, radius);
        equatorPoints.push(new THREE.Vector3(pos.x, pos.y, pos.z));
    }
    const equatorGeometry = new THREE.BufferGeometry().setFromPoints(equatorPoints);
    const equator = new THREE.Line(equatorGeometry, equatorMaterial);
    scene.add(equator);
    
    // Label the equator
    const eqLabelPos = raDecToCartesian(0, 0, radius + 2);
    //addTextLabel('0°', eqLabelPos.x, eqLabelPos.y, eqLabelPos.z, 0.8);
}

function addTextLabel(text, x, y, z, size) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 128;
    
    // Clear canvas to be fully transparent
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    context.fillStyle = 'rgba(255, 255, 255, 0.8)';
    context.font = 'Bold 40px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 128, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture,
        transparent: true,
        opacity: 0.6,
        depthTest: true,  // Respect depth so pictures can cover labels
        depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.set(x, y, z);
    sprite.scale.set(size * 3, size * 1.5, 1);
    sprite.renderOrder = -1;  // Render labels before stars
    scene.add(sprite);
    return sprite; // Return the sprite so we can control visibility
}

function updateLabelVisibility(fov) {
    // Calculate magnitude threshold based on FOV
    // At FOV 75 (default): only show stars brighter than magnitude 1.5
    // At FOV 20 (max zoom): show stars up to magnitude 3.5
    const minFov = 20;
    const maxFov = 90;
    const minMag = 1.5;
    const maxMag = 3.5;
    
    // Logarithmic interpolation for smoother transition
    const t = Math.log(maxFov / fov) / Math.log(maxFov / minFov);
    const magThreshold = minMag + (maxMag - minMag) * t;
    
    // Calculate zoom factor - inverse of star size growth to maintain pixel distance
    const zoomFactor = 1.0 / (Math.log(90.0 / fov) * 0.5 + 1.0);
    
    // Show/hide labels based on magnitude threshold
    starLabels.forEach(item => {
        item.label.visible = item.magnitude <= magThreshold;
        if (item.label.visible && item.basePos) {
            item.label.position.y = item.basePos.y + (0.8 * zoomFactor);
        }
    });
}

function updateObjectLabelPositions(fov) {
    // Calculate zoom factor - inverse of picture size to maintain pixel distance
    const zoomFactor = 1.0 / (Math.log(90.0 / fov) * 0.5 + 1.0);
    
    objectLabels.forEach(item => {
        item.label.position.y = item.basePos.y - (item.baseOffset * zoomFactor);
    });
}

function raDecToCartesian(ra, dec, radius = 40) {
    // Convert RA (hours) and Dec (degrees) to radians
    const raRad = (ra * 15) * Math.PI / 180; // RA in hours to degrees to radians
    const decRad = dec * Math.PI / 180;
    
    // Convert to Cartesian coordinates
    const x = radius * Math.cos(decRad) * Math.cos(raRad);
    const y = radius * Math.sin(decRad);
    const z = -radius * Math.cos(decRad) * Math.sin(raRad);
    
    return { x, y, z };
}

function addCelestialObject(name, ra, dec, imageUrl) {
    const pos = raDecToCartesian(ra, dec);
    
    const texture = new THREE.TextureLoader().load(imageUrl);
    const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture,
        transparent: false,
        opacity: 1.0
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.set(pos.x, pos.y, pos.z);
    sprite.scale.set(3, 3, 1);
    sprite.userData = { name, ra, dec, imageUrl };
    sprite.renderOrder = 10; // Render pictures last, on top of everything
    
    scene.add(sprite);
    objects.push(sprite);
    
    // Add label for the picture object
    //const label = addTextLabel(name, pos.x, pos.y - 2.3, pos.z, 0.5);
    //label.renderOrder = 0; // Render picture labels with star labels
    //objectLabels.push({
    //    label: label,
    //    sprite: sprite,
    //    basePos: { x: pos.x, y: pos.y, z: pos.z },
    //    baseOffset: 2.3 // Distance below picture (1.5 for half picture height + 0.8 spacing)
    //});
}

function updateObjectList() {
    const list = document.getElementById('objectList');
    list.innerHTML = '<strong>Available Pictures:</strong>';
    objects.forEach((obj, i) => {
        const div = document.createElement('div');
        div.className = 'object-item';
        div.textContent = `${obj.userData.name} (RA: ${obj.userData.ra.toFixed(2)}h, Dec: ${obj.userData.dec.toFixed(2)}°)`;
        div.onclick = () => focusOnObject(obj);
        list.appendChild(div);
    });
}

function focusOnObject(obj) {
    // Calculate direction to object
    const direction = new THREE.Vector3();
    direction.copy(obj.position).normalize();
    
    // Orient camera to look at the object
    camera.lookAt(obj.position);
}

function onMouseDown(e) {
    isDragging = true;
    hasDragged = false; // Reset drag flag
    previousMousePosition = { x: e.clientX, y: e.clientY };
    
    // Store starting camera orientation and mouse position in NDC
    dragStartQuaternion.copy(camera.quaternion);
    dragStartMouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    dragStartMouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function onMouseMove(e) {
    if (isDragging && e.buttons === 1) {
        // Mark that user has dragged
        hasDragged = true;
        
        // Get current mouse position in NDC
        const currentMouseNDC = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        
        // Calculate the mouse delta in NDC space
        const deltaNDC = new THREE.Vector2(
            currentMouseNDC.x - dragStartMouseNDC.x,
            currentMouseNDC.y - dragStartMouseNDC.y
        );
        
        // Convert NDC delta to angular rotation
        // Scale by FOV to maintain 1:1 tracking at any zoom level
        const fovScale = camera.fov / 75; // Normalize to default FOV
        const yaw = deltaNDC.x * (camera.fov * Math.PI / 180) * (window.innerWidth / window.innerHeight);
        const pitch = -deltaNDC.y * (camera.fov * Math.PI / 180);
        
        // Apply rotations from the starting orientation
        camera.quaternion.copy(dragStartQuaternion);
        
        // Rotate around Y axis (yaw)
        const quaternionY = new THREE.Quaternion();
        quaternionY.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        camera.quaternion.multiplyQuaternions(quaternionY, camera.quaternion);
        
        // Rotate around local X axis (pitch)
        const quaternionX = new THREE.Quaternion();
        quaternionX.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
        camera.quaternion.multiplyQuaternions(camera.quaternion, quaternionX);
        
        previousMousePosition = { x: e.clientX, y: e.clientY };
    }
}

function onMouseUp() {
    isDragging = false;
}

function onTouchStart(e) {
    e.preventDefault();
    
    if (e.touches.length === 1) {
        // Single touch - rotation
        isDragging = true;
        const touch = e.touches[0];
        previousMousePosition = { x: touch.clientX, y: touch.clientY };
        
        dragStartQuaternion.copy(camera.quaternion);
        dragStartMouseNDC.x = (touch.clientX / window.innerWidth) * 2 - 1;
        dragStartMouseNDC.y = -(touch.clientY / window.innerHeight) * 2 + 1;
    } else if (e.touches.length === 2) {
        // Two touches - pinch zoom
        isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDistance = Math.sqrt(dx * dx + dy * dy);
        touchStartFov = camera.fov;
    }
}

function onTouchMove(e) {
    e.preventDefault();
    
    if (e.touches.length === 1 && isDragging) {
        // Single touch rotation
        const touch = e.touches[0];
        const currentMouseNDC = new THREE.Vector2(
            (touch.clientX / window.innerWidth) * 2 - 1,
            -(touch.clientY / window.innerHeight) * 2 + 1
        );
        
        const deltaNDC = new THREE.Vector2(
            currentMouseNDC.x - dragStartMouseNDC.x,
            currentMouseNDC.y - dragStartMouseNDC.y
        );
        
        const fovScale = camera.fov / 75;
        const yaw = deltaNDC.x * (camera.fov * Math.PI / 180) * (window.innerWidth / window.innerHeight);
        const pitch = -deltaNDC.y * (camera.fov * Math.PI / 180);
        
        camera.quaternion.copy(dragStartQuaternion);
        
        const quaternionY = new THREE.Quaternion();
        quaternionY.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        camera.quaternion.multiplyQuaternions(quaternionY, camera.quaternion);
        
        const quaternionX = new THREE.Quaternion();
        quaternionX.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
        camera.quaternion.multiplyQuaternions(camera.quaternion, quaternionX);
        
        previousMousePosition = { x: touch.clientX, y: touch.clientY };
    } else if (e.touches.length === 2) {
        // Pinch zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const scale = touchStartDistance / distance;
        camera.fov = Math.min(90, Math.max(10, touchStartFov * scale));
        camera.updateProjectionMatrix();
        
        // Update star material and labels
        if (window.starMaterial) {
            window.starMaterial.uniforms.fov.value = camera.fov;
        }
        updateLabelVisibility(camera.fov);
    }
}

function onTouchEnd(e) {
    if (e.touches.length === 0) {
        isDragging = false;
    } else if (e.touches.length === 1) {
        // Restart single touch tracking
        const touch = e.touches[0];
        previousMousePosition = { x: touch.clientX, y: touch.clientY };
        dragStartQuaternion.copy(camera.quaternion);
        dragStartMouseNDC.x = (touch.clientX / window.innerWidth) * 2 - 1;
        dragStartMouseNDC.y = -(touch.clientY / window.innerHeight) * 2 + 1;
    }
}

function onWheel(e) {
    e.preventDefault();
    const zoomSpeed = 5;
    
    // Change FOV
    if (e.deltaY > 0) {
        camera.fov = Math.min(90, camera.fov + zoomSpeed);
    } else {
        camera.fov = Math.max(10, camera.fov - zoomSpeed);
    }
    camera.updateProjectionMatrix();
    
    // Update star material FOV uniform for zoom-dependent sizing
    if (window.starMaterial) {
        window.starMaterial.uniforms.fov.value = camera.fov;
    }
    
    // Update label visibility based on zoom level
    updateLabelVisibility(camera.fov);
    updateObjectLabelPositions(camera.fov);
}

function onClick(e) {
    // Don't show popup if user dragged the view
    if (hasDragged) {
        return;
    }
    
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    // Only check visible objects
    const visibleObjects = objects.filter(obj => obj.visible);
    const intersects = raycaster.intersectObjects(visibleObjects);
    
    if (intersects.length > 0) {
        const obj = intersects[0].object;
        alert(`${obj.userData.name}\nRA: ${obj.userData.ra.toFixed(3)}h\nDec: ${obj.userData.dec.toFixed(3)}°`);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function toggleControls() {
    const controls = document.getElementById('controls');
    const button = event.target;
    
    if (controls.classList.contains('minimized')) {
        controls.classList.remove('minimized');
        button.textContent = 'Hide Panel';
    } else {
        controls.classList.add('minimized');
        button.textContent = 'Show Panel';
    }
}

function togglePictures() {
    picturesVisible = !picturesVisible;
    const button = event.target;
    
    objects.forEach(obj => {
        obj.visible = picturesVisible;
    });
    
    button.textContent = picturesVisible ? 'Hide All Pictures' : 'Show All Pictures';
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// Disable context menu for right-click
document.addEventListener('contextmenu', e => e.preventDefault());

init();