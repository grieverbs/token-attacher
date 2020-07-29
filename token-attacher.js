(async () => {
	//CONFIG.debug.hooks = true
	class TokenAttacher {
		static initialize(){
			if(TokenAttacher.isFirstActiveGM()){
				canvas.scene.unsetFlag("token-attacher","selected");
				console.log("Token Attacher| Initzialized");
			}

			window['token-attacher'] = {};
			window['token-attacher'].selected = {};
			//Sightupdate workaround until 0.7.x fixes wall sight behaviour
			window['token-attacher'].updateSight={};
			window['token-attacher'].updateSight.walls=[];

			Hooks.on("preUpdateToken", (parent, doc, update, options, userId) => TokenAttacher.UpdateAttachedOfToken(parent, doc, update, options, userId));
			Hooks.on("UpdateToken", (parent, doc, update, options, userId) => TokenAttacher.AfterUpdateWallsWithToken(parent, doc, update, options, userId));
			//Sightupdate workaround until 0.7.x fixes wall sight behaviour
			Hooks.on("updateWall", (entity, data, options, userId) => TokenAttacher.performSightUpdates(entity, data, options, userId));
		}


		static UpdateAttachedOfToken(parent, doc, update, options, userId){
			const token = canvas.tokens.get(update._id);
			const attached=token.getFlag("token-attacher", "attached") || {};
			const tokenCenter = token.center;
			if(Object.keys(attached).length = 0) return;

			console.log("WallToTokenLinker |  this is a attached ");
			TokenAttacher.detectGM();

			let deltaX = 0;
			let deltaY = 0;
			let deltaRot = 0;
			let needUpdate= false;
			if(update.hasOwnProperty("x")){
				deltaX = update.x - token.data.x;
				needUpdate=true;
			}
			if(update.hasOwnProperty("y")){
				deltaY = update.y - token.data.y;
				needUpdate=true;
			}
			if(update.hasOwnProperty("rotation")){
				deltaRot = update.rotation - token.data.rotation;
				needUpdate=true;
			}
			
			if(!needUpdate) return;
			const deltas = [tokenCenter, deltaX, deltaY, deltaRot];
			TokenAttacher.updateAttached(attached, deltas, "tiles", TokenAttacher._updateTiles);
			TokenAttacher.updateAttached(attached, deltas, "lighting", TokenAttacher._updateLighting);
			TokenAttacher.updateAttached(attached, deltas, "sounds", TokenAttacher._updateSounds);
			TokenAttacher.updateAttached(attached, deltas, "walls", TokenAttacher._updateWalls);
		}

		static updateAttached(attached, deltas, type, callback){
			if(attached.hasOwnProperty(type)){
				console.log("Token Attacher| this is a attached with attached" + type);

				const data = [attached[type]].concat(deltas);
				if(TokenAttacher.isFirstActiveGM()){
					callback(...data);
				}
				else{
					game.socket.emit('module.token-attacher', {event: `update${type.charAt(0).toUpperCase() + type.slice(1)}`, eventdata: data});
				}
				
			}
		}

		static AfterUpdateWallsWithToken(parent, doc, update, options, userId){
			const token = canvas.tokens.get(update._id);
			const attached=token.getFlag("token-attacher", "attached") || {};
			if(Object.keys(attached).length = 0) return;
			
			let needUpdate= false;
			if(		update.hasOwnProperty("x")
				||	update.hasOwnProperty("y")
				||	update.hasOwnProperty("rotation")){
				needUpdate= true;
			}

			if(!needUpdate) return;

			if(TokenAttacher.isFirstActiveGM()){
				TokenAttacher._CheckAttachedOfToken(token);
			}
		}

		/**
		 * Workaround until 0.7.x fixes wall sight behaviour
		 */
		static performSightUpdates(entity, data, options, userId){
			if(window['token-attacher'].updateSight.hasOwnProperty("walls")) {
				if(window['token-attacher'].updateSight.walls.length > 0){
					const index = window['token-attacher'].updateSight.walls.indexOf(data._id);
					if(index != -1){
						window['token-attacher'].updateSight.walls.splice(index, 1);
						if(window['token-attacher'].updateSight.walls.length == 0){
							TokenAttacher.updateSight();
						}
					}
				}
				return;
			}
		}
		/**
		 * Workaround until 0.7.x fixes wall sight behaviour
		 */
		static async updateSight(){
			console.log("Token Attacher| Force Sight update");
			await canvas.sight.initialize(); // This needs to happen first to rebuild FOV/LOS polygons
			canvas.lighting.initialize();
			canvas.sounds.initialize();
		}
		/**
		 * Workaround until 0.7.x fixes wall sight behaviour
		 */
		static pushSightUpdate(attached){
			for (const key in attached) {
				if (attached.hasOwnProperty(key)) {
					window['token-attacher'].updateSight[key]= Array.from(new Set((window['token-attacher'].updateSight[key] || []).concat(attached[key])));
					
				}
			}			
		}
		
		static _updateWalls(walls, tokenCenter, deltaX, deltaY, deltaRot){
				//Sightupdate workaround until 0.7.x fixes wall sight behaviour
				TokenAttacher.pushSightUpdate(...[{walls:walls}]);
				game.socket.emit('module.token-attacher', {event: "updateSight", eventdata: [{walls:walls}]});

				const layer = Wall.layer;
				const snap = false;
						
				// Move Wall
				if(deltaX != 0 || deltaY != 0 || deltaRot != 0){
					let updates = walls.map(w => {
						const wall = canvas.walls.get(w) || {};
						if(Object.keys(wall).length == 0) return;

						let c = duplicate(wall.data.c);
						[c[0],c[1]]  = TokenAttacher.moveRotatePoint({x:c[0], y:c[1], rotation:0}, tokenCenter,deltaX, deltaY, deltaRot);
						[c[2],c[3]]  = TokenAttacher.moveRotatePoint({x:c[2], y:c[3], rotation:0}, tokenCenter,deltaX, deltaY, deltaRot);

						let p0 = layer._getWallEndpointCoordinates({x: c[0], y: c[1]}, {snap});
						let p1 = layer._getWallEndpointCoordinates({x: c[2], y: c[3]}, {snap});

						return {_id: wall.data._id, c: p0.concat(p1)}
					});
					updates = updates.filter(n => n);
					if(Object.keys(updates).length == 0)  return; 
					canvas.scene.updateEmbeddedEntity("Wall", updates);
				}
		}

		static _updateTiles(tiles, tokenCenter, deltaX, deltaY, deltaRot){
			const layer = Tile.layer;
					
			// Move Tile
			if(deltaX != 0 || deltaY != 0 || deltaRot != 0){
				let updates = tiles.map(w => {
					const tile = canvas.tiles.get(w) || {};
					if(Object.keys(tile).length == 0) return;
					return TokenAttacher.moveRotateRectangle(tile, tokenCenter, deltaX, deltaY, deltaRot);
				});
				updates = updates.filter(n => n);
				if(Object.keys(updates).length == 0)  return; 
				canvas.scene.updateEmbeddedEntity("Tile", updates);
			}
		}

		static _updateLighting(lighting, tokenCenter, deltaX, deltaY, deltaRot){
			const layer = AmbientLight.layer;
					
			// Move Light
			if(deltaX != 0 || deltaY != 0 || deltaRot != 0){
				let updates = lighting.map(w => {
					const light = canvas.lighting.get(w) || {};
					let p = TokenAttacher.moveRotatePoint({x:light.data.x, y:light.data.y, rotation:light.data.rotation}, tokenCenter, deltaX, deltaY, deltaRot);
					return {_id: light.data._id, x: p[0], y: p[1], rotation: p[2]};
				});
				updates = updates.filter(n => n);
				if(Object.keys(updates).length == 0)  return; 
				canvas.scene.updateEmbeddedEntity("AmbientLight", updates);
			}
		}

		static _updateSounds(sounds, tokenCenter, deltaX, deltaY, deltaRot){
			const layer = AmbientSound.layer;
					
			// Move Sound
			if(deltaX != 0 || deltaY != 0 || deltaRot != 0){
				let updates = sounds.map(w => {
					const sound = canvas.sounds.get(w) || {};
					let p = TokenAttacher.moveRotatePoint({x:sound.data.x, y:sound.data.y, rotation:0}, tokenCenter, deltaX, deltaY, deltaRot);
					return {_id: sound.data._id, x: p[0], y: p[1]};
				});
				updates = updates.filter(n => n);
				if(Object.keys(updates).length == 0)  return; 
				canvas.scene.updateEmbeddedEntity("AmbientSound", updates);
			}
		}

		static computeRotatedPosition(x,y,x2,y2,rotRad){
			const dx = x2 - x,
			dy = y2 - y;
			return [x + Math.cos(rotRad)*dx - Math.sin(rotRad)*dy,
				y + Math.sin(rotRad)*dx + Math.cos(rotRad)*dy];
		}

		/**
		 * Moves a rectangle by delta values and rotates around an anchor by a delta
		 * A rectangle is defined by having a center, data._id, data.x, data.y and data.rotation
		 */
		static moveRotateRectangle(rect, anchor, deltaX, deltaY, deltaRot){			
			let rectCenter = duplicate(rect.center);
			rectCenter.x += deltaX;
			rectCenter.y += deltaY;

			let x = rect.data.x;
			let y = rect.data.y;
			x +=deltaX;
			y +=deltaY;
			let rotation = rect.data.rotation;

			if(deltaRot !=0){
				// get vector from center to template
				const deltaRotRad = toRadians(deltaRot);
				// rotate vector around angle
				[rectCenter.x,rectCenter.y] = TokenAttacher.computeRotatedPosition(anchor.x, anchor.y, rectCenter.x, rectCenter.y, deltaRotRad);
				rotation+=deltaRot;
				
			}
			let rectDeltaX = rectCenter.x-(rect.center.x+deltaX);
			let rectDeltaY = rectCenter.y-(rect.center.y+deltaY);
			x += rectDeltaX;
			y += rectDeltaY;
			return {_id: rect.data._id, x: x, y: y, rotation: rotation};
		}

		/**
		 * Moves a rectangle by delta values and rotates around an anchor by a delta
		 * A rectangle is defined by having a center, data._id, data.x, data.y and data.rotation
		 */
		static moveRotatePoint(point, anchor, deltaX, deltaY, deltaRot){			
			point.x += deltaX;
			point.y += deltaY;
			point.rotation+=deltaRot;
			if(deltaRot !=0){
				// get vector from center to template
				const deltaRotRad = toRadians(deltaRot);
				// rotate vector around angle
				[point.x, point.y] = TokenAttacher.computeRotatedPosition(anchor.x, anchor.y, point.x, point.y, deltaRotRad);
				
			}	
			return [point.x, point.y, point.rotation];
		}

		/**
		 * Only the first active GM has to do the work
		 */
		static isFirstActiveGM(){
			const firstGm = game.users.find((u) => u.isGM && u.active);
			if (firstGm && game.user !== firstGm) {
				return false;
			}
			return true;
		}

		/**
		 * Warn the player if a token was moved that has attached parts
		 */
		static detectGM(){
			const firstGm = game.users.find((u) => u.isGM && u.active);
			if(!firstGm){
				return ui.notifications.error(game.i18n.localize("TOKENATTACHER.error.NoActiveGMFound"));
			}
		}
		
		/**
		 * Listen to custom socket events, so players can move walls indirectly through the gm
		 */
		static listen(data){
			console.log("Token Attacher| some event");
			switch (data.event) {
				case "updateWalls":
					if(TokenAttacher.isFirstActiveGM()){
						console.log("Token Attacher| Event updateWalls");
						TokenAttacher._updateWalls(...data.eventdata);
					}
					break;
				case "updateTiles":
					if(TokenAttacher.isFirstActiveGM()){
						console.log("Token Attacher| Event updateTiles");
						TokenAttacher._updateTiles(...data.eventdata);
					}
					break;
				case "updateLighting":
					if(TokenAttacher.isFirstActiveGM()){
						console.log("Token Attacher| Event updateLighting");
						TokenAttacher._updateLighting(...data.eventdata);
					}
					break;				
				case "updateSounds":
					if(TokenAttacher.isFirstActiveGM()){
						console.log("Token Attacher| Event updateSounds");
						TokenAttacher._updateSounds(...data.eventdata);
					}
					break;
				case "updateSight":
					console.log("Token Attacher| Event updateSight");
					TokenAttacher.pushSightUpdate(...data.eventdata);
					break;
				default:
					console.log("Token Attacher| wtf did I just read?");
					break;
			}
		}

		/**
		 * Attach previously saved selection to the currently selected token
		 */
		static _AttachToToken(){
			if(Object.keys(canvas.tokens._controlled).length <= 0) return ui.notifications.error(game.i18n.localize("TOKENATTACHER.error.NoTokensSelected"));

			const controlledTokens = Object.keys(canvas.tokens._controlled);
			for (let index = 0; index < controlledTokens.length; index++) {
				const controlledToken = canvas.tokens.get(controlledTokens[index]);
				
				const selection=window['token-attacher'].selected || {};
				if(selection.hasOwnProperty("type")){
					let attached=controlledToken.getFlag("token-attacher", "attached") || {};
					
					attached[selection.type]=selection.data;
					controlledToken.unsetFlag("token-attacher", "attached").then(()=>{
						controlledToken.setFlag("token-attacher", "attached", attached);
						ui.notifications.info(game.i18n.localize("TOKENATTACHER.info.ObjectsAttached"));
					})
					switch ( selection.type ) {
						case "sounds":
							console.log("Token Attacher| Attach Sounds");
							break;
						case "lighting":
							console.log("Token Attacher| Attach Lighting");
							break;
						case "walls":
							console.log("Token Attacher| Attach Walls");
							break;
						case "tiles":
							console.log("Token Attacher| Attach Tiles");
							break;
						default:
							;
					  }
					window['token-attacher'].selected = {};
					return; 
				}
			}
		}

		/**
		 * Check previously attached of the token and remove deleted items
		 */
		static _CheckAttachedOfToken(token){
			let attached=token.getFlag("token-attacher", "attached") || {};
			
			attached = TokenAttacher._removeAttachedRemnants(attached, "sounds");
			attached = TokenAttacher._removeAttachedRemnants(attached, "lighting");
			attached = TokenAttacher._removeAttachedRemnants(attached, "walls");
			attached = TokenAttacher._removeAttachedRemnants(attached, "tiles");

			token.unsetFlag("token-attacher", "attached").then(()=>{
				token.setFlag("token-attacher", "attached", attached);
			});
		}

		static _removeAttachedRemnants(attached, type){
			if(attached.hasOwnProperty(type)){
				let objects=attached[type].map(w => {
					const obj = canvas[type].get(w) || {};
					if(Object.keys(obj).length == 0) return;
					return w;
				});
				objects = objects.filter(n => n);
				attached[type]=objects;
			}	
			return attached;
		}

		/**
		 * Detach previously saved selection of walls to the currently selected token
		 */
		static _DetachFromToken(){
			if(Object.keys(canvas.tokens._controlled).length <= 0) return ui.notifications.error(game.i18n.localize("TOKENATTACHER.error.NoTokensSelected"));

			const controlledTokens = Object.keys(canvas.tokens._controlled);
			for (let index = 0; index < controlledTokens.length; index++) {
				const controlledToken = canvas.tokens.get(controlledTokens[index]);
				
				controlledToken.unsetFlag("token-attacher", "attached");
				ui.notifications.info(game.i18n.localize("TOKENATTACHER.info.ObjectsDetached"));
			}
		}
		
		/**
		 * Save the selected objects so the selection can be reused later 
		 */
		static _SaveSelection(type){
			if(Object.keys(canvas[type]._controlled).length <= 0) return ui.notifications.error(game.i18n.localize(`TOKENATTACHER.error.NothingSelected`));
			const selected = Object.keys(canvas[type]._controlled);
			
			window['token-attacher'].selected= {type:type, data:selected};
			ui.notifications.info(game.i18n.localize("TOKENATTACHER.info.SelectionSaved"));
		}

		/**
		 * Hook into the toolbar and add buttons 
		 */
		static _getControlButtons(controls){
			for (let i = 0; i < controls.length; i++) {
				if(controls[i].name === "token"){
					controls[i].tools.push({
						name: "TAAttachToToken",
						title: game.i18n.localize("TOKENATTACHER.button.AttachToToken"),
						icon: "fas fa-link",
						visible: game.user.isGM,
						onClick: () => TokenAttacher._AttachToToken(),
						button: true
					  });
					  controls[i].tools.push({
						  name: "TADetachFromToken",
						  title: game.i18n.localize("TOKENATTACHER.button.DetachFromToken"),
						  icon: "fas fa-unlink",
						  visible: game.user.isGM,
						  onClick: () => TokenAttacher._DetachFromToken(),
						  button: true
						});
				}
				else if(controls[i].name === "tiles"){
					controls[i].tools.push({
						name: "TASaveTileSelection",
						title: game.i18n.localize("TOKENATTACHER.button.SaveSelection"),
						icon: "fas fa-object-group",
						visible: game.user.isGM,
						onClick: () => TokenAttacher._SaveSelection('tiles'),
						button: true
					  });
				}
				else if(controls[i].name === "walls"){
					controls[i].tools.push({
						name: "TASaveWallSelection",
						title: game.i18n.localize("TOKENATTACHER.button.SaveSelection"),
						icon: "fas fa-object-group",
						visible: game.user.isGM,
						onClick: () => TokenAttacher._SaveSelection('walls'),
						button: true
					  });
				}
				else if(controls[i].name === "lighting"){
					controls[i].tools.push({
						name: "TASaveLightingSelection",
						title: game.i18n.localize("TOKENATTACHER.button.SaveSelection"),
						icon: "fas fa-object-group",
						visible: game.user.isGM,
						onClick: () => TokenAttacher._SaveSelection('lighting'),
						button: true
					  });
				}
				else if(controls[i].name === "sounds"){
					controls[i].tools.push({
						name: "TASaveSoundsSelection",
						title: game.i18n.localize("TOKENATTACHER.button.SaveSelection"),
						icon: "fas fa-object-group",
						visible: game.user.isGM,
						onClick: () => TokenAttacher._SaveSelection('sounds'),
						button: true
					  });
				}
			}
			console.log("WallToTokenLinker | Tools added.");
		}
	}

	Hooks.on('getSceneControlButtons', (controls) => TokenAttacher._getControlButtons(controls));
	Hooks.on('canvasReady', () => TokenAttacher.initialize());
	Hooks.once('ready', () => {
		game.socket.on('module.token-attacher', (data) => TokenAttacher.listen(data));
	});
})();
