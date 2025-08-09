/**
 * @author fernandojsg / http://fernandojsg.com
 * @author mrdoob / http://mrdoob.com
 * @author Mugen87 / https://github.com/Mugen87
 * @author NikLever / http://niklever.com
 */

THREE.GLTFLoader = function ( manager ) {

	this.manager = ( manager !== undefined ) ? manager : THREE.DefaultLoadingManager;

	this.dracoLoader = null;
	this.ktx2Loader = null;
	this.meshoptDecoder = null;

	this.pluginCallbacks = [];

	this.register( function ( parser ) {

		return new GLTFMaterialsClearcoatExtension( parser );

	} );

	this.register( function ( parser ) {

		return new GLTFTextureBasisUExtension( parser );

	} );

	this.register( function ( parser ) {

		return new GLTFTextureWebPExtension( parser );

	} );

	this.register( function ( parser ) {

		return new GLTFMeshoptCompression( parser );

	} );

	this.register( function ( parser ) {

		return new GLTFMeshGpuInstancing( parser );

	} );

	this.register( function ( parser ) {

		return new GLTFLightMapExtension( parser );

	} );

	this.register( function ( parser ) {

		return new GLTFMultiPrimitiveExtension( parser );

	} );

	this.register( function ( parser ) {

		return new GLTFMeshoptCompression( parser );

	} );

};

THREE.GLTFLoader.prototype = {

	constructor: THREE.GLTFLoader,

	load: function ( url, onLoad, onProgress, onError ) {

		const resourcePath = THREE.LoaderUtils.extractUrlBase( url );

		this.loadResource( url, ( gltf ) => {

			// Here we can process the gltf before returning it
			onLoad( gltf );

		}, onProgress, onError, resourcePath );

	},

	loadResource: function ( url, onLoad, onProgress, onError, resourcePath ) {

		const loader = new THREE.FileLoader( this.manager );
		loader.setPath( resourcePath );
		loader.setResponseType( 'arraybuffer' );

		loader.load( url, ( data ) => {

			try {

				const gltf = this.parse( data, resourcePath );
				onLoad( gltf );

			} catch ( error ) {

				if ( onError ) {

					onError( error );

				} else {

					console.error( error );

				}

				this.manager.itemError( url );

			}

		}, onProgress, onError );

	},

	parse: function ( data, path ) {

		const content = this.parseContent( data, path );
		const extensions = content.extensions || {};
		const parser = new GLTFParser( this, content, extensions, path );

		return parser.parse();

	},

	parseContent: function ( data, path ) {

		const magic = THREE.LoaderUtils.decodeText( new Uint8Array( data, 0, 4 ) );

		if ( magic === 'glTF' ) {

			const version = new DataView( data ).getUint32( 4, true );

			if ( version === 2 ) {

				const glbHeader = new DataView( data );
				const glbVersion = glbHeader.getUint32( 4, true );
				const glbLength = glbHeader.getUint32( 8, true );

				if ( glbVersion !== 2 ) {

					throw new Error( 'THREE.GLTFLoader: Legacy binary file detected. Use LegacyGLTFLoader instead.' );

				}

				const glbMagic = glbHeader.getUint32( 0, true );
				if ( glbMagic !== 0x46546C67 ) {

					throw new Error( 'THREE.GLTFLoader: Invalid glTF binary.' );

				}

				const chunkLength = glbHeader.getUint32( 12, true );
				const chunkType = glbHeader.getUint32( 16, true );

				if ( chunkType !== 0x4E4F534A ) {

					throw new Error( 'THREE.GLTFLoader: Invalid glTF binary.' );

				}

				const chunkData = new Uint8Array( data, 20, chunkLength );
				const content = JSON.parse( THREE.LoaderUtils.decodeText( chunkData ) );

				content.buffers = content.buffers || [];

				const buffer = {
					byteLength: glbLength - 20 - chunkLength,
					uri: undefined
				};

				content.buffers.push( buffer );

				return content;

			}

		}

		return JSON.parse( THREE.LoaderUtils.decodeText( new Uint8Array( data ) ) );

	},

	register: function ( callback ) {

		this.pluginCallbacks.push( callback );

	},

	unregister: function ( callback ) {

		const index = this.pluginCallbacks.indexOf( callback );
		if ( index !== - 1 ) {

			this.pluginCallbacks.splice( index, 1 );

		}

	},

	loadBufferView: function ( bufferViewIndex ) {

		const bufferView = this.json.bufferViews[ bufferViewIndex ];
		const buffer = this.buffers[ bufferView.buffer ];

		const byteLength = bufferView.byteLength || 0;
		const byteOffset = bufferView.byteOffset || 0;

		return buffer.slice( byteOffset, byteOffset + byteLength );

	},

	loadBuffer: function ( bufferIndex ) {

		const buffer = this.json.buffers[ bufferIndex ];

		if ( buffer.uri === undefined && bufferIndex === 0 ) {

			return Promise.resolve( this.extensions[ 'KHR_binary_glTF' ].body );

		}

		const loader = this.fileLoader;
		const resourcePath = this.resourcePath;

		return new Promise( ( resolve, reject ) => {

			loader.load( resourcePath + buffer.uri, resolve, undefined, reject );

		} );

	},

	loadImage: function ( imageIndex ) {

		const image = this.json.images[ imageIndex ];
		const loader = this.textureLoader;
		const resourcePath = this.resourcePath;

		return new Promise( ( resolve, reject ) => {

			loader.load( resourcePath + image.uri, resolve, undefined, reject );

		} );

	},

	loadTexture: function ( textureIndex ) {

		const texture = this.json.textures[ textureIndex ];
		const image = this.json.images[ texture.source ];

		return this.loadImage( texture.source ).then( ( image ) => {

			const texture = new THREE.Texture( image );
			texture.flipY = false;

			if ( textureInfo.sampler !== undefined ) {

				const sampler = this.json.samplers[ textureInfo.sampler ];
				texture.magFilter = THREE.LinearFilter;
				texture.minFilter = THREE.LinearFilter;
				texture.wrapS = THREE.ClampToEdgeWrapping;
				texture.wrapT = THREE.ClampToEdgeWrapping;

			}

			return texture;

		} );

	}

};

// GLTFParser class (simplified version)
function GLTFParser( loader, json, extensions, resourcePath ) {

	this.loader = loader;
	this.json = json;
	this.extensions = extensions;
	this.resourcePath = resourcePath;
	this.buffers = [];
	this.textureLoader = new THREE.TextureLoader( loader.manager );
	this.fileLoader = new THREE.FileLoader( loader.manager );

}

GLTFParser.prototype = {

	parse: function () {

		const gltf = {
			scene: null,
			scenes: [],
			animations: [],
			cameras: [],
			asset: {}
		};

		return Promise.resolve( gltf );

	}

};

// Extension classes (simplified)
function GLTFMaterialsClearcoatExtension( parser ) {}
function GLTFTextureBasisUExtension( parser ) {}
function GLTFTextureWebPExtension( parser ) {}
function GLTFMeshoptCompression( parser ) {}
function GLTFMeshGpuInstancing( parser ) {}
function GLTFLightMapExtension( parser ) {}
function GLTFMultiPrimitiveExtension( parser ) {}
