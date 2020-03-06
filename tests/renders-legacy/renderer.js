'use strict';

const md5 = require('js-md5');
const path = require('path');
const ImageDiff = require('./imagediff');

/**
 * Class to create solutions
 * @class Renderer
 * @constructor
 */
const Renderer = function(viewWebGL, viewContext2d) {
    this.stage = new PIXI.Container();
    this.hasWebGL = PIXI.utils.isWebGLSupported();
    if (this.hasWebGL) {
        this.webgl = new PIXI.Renderer({
            width: Renderer.WIDTH,
            height: Renderer.HEIGHT,
            view: viewWebGL,
            backgroundColor: 0xffffff,
            antialias: false,
            preserveDrawingBuffer: true
        });
    }
    PIXI.settings.ROUND_PIXELS = true;
    this.canvas = new PIXI.CanvasRenderer({
        width: Renderer.WIDTH,
        height: Renderer.HEIGHT,
        view: viewContext2d,
        backgroundColor: 0xffffff,
        antialias: false,
        preserveDrawingBuffer: true,
        // roundPixels: true
    });
    this.canvas.smoothProperty = null;
    this.render();

    this.instance = null;
    this.imagediff = new ImageDiff(Renderer.WIDTH, Renderer.HEIGHT);
};

// Reference to the prototype
const p = Renderer.prototype;

Renderer.WIDTH = 32;
Renderer.HEIGHT = 32;
Renderer.WEBGL_TOLERANCE = 0.01;
// Prerendered solutions were created in an older version of Floss, and thus and older version
// of Electron, so there are some canvas differences that we will let slide.
Renderer.CANVAS_TOLERANCE = 0.06;

/**
 * Rerender the stage
 * @method render
 */
p.render = function() {
    if (this.hasWebGL) {
        this.webgl.render(this.stage);
    }
    this.canvas.render(this.stage);
};

/**
 * Clear the stage
 * @method clear
 */
p.clear = function() {
    this.stage.removeChildren();
    if (this.instance) {
        this.instance.destroy(true);
        this.instance = null;
    }
    this.render();
};

/**
 * Run the solution renderer
 * @method run
 * @param {String} file Fully resolved path
 * @param {Function} callback Takes error and result as arguments
 */
p.run = function(file, callback) {
    delete require.cache[path.resolve(file)];
    let fla = require(file);
    if (!Object.keys(fla).length || !fla.stage) {
        return callback(new Error('Invalid PixiAnimate format, make sure to enable "CommonJS Compatible Output" option in the Adobe Animate publishing settings.'));
    }
    PIXI.animate.load(fla.stage, (instance) => {
        this.clear();
        this.instance = instance;
        this.stage.addChild(instance);
        const result = {
            webgl: [],
            canvas: []
        };

        for(let i = 0; i < fla.totalFrames; i++) {
            let data;
            instance.gotoAndStop(i);
            this.render();
            if (this.hasWebGL) {
                data = this.webgl.view.toDataURL();
                result.webgl.push({
                    hash: md5(data),
                    image: data
                });
            }
            data = this.canvas.view.toDataURL();
            result.canvas.push({
                hash: md5(data),
                image: data
            });
        }
        callback(null, result);
    }, path.dirname(file));
};

/**
 * Compare a file with a solution.
 * @method compare
 * @param {String} file The file to load.
 * @param {Object} solution
 * @param {Array<String>} solution.webgl
 * @param {Array<String>} solution.canvas
 * @param {Function} callback Complete callback, takes err as an error and success boolean as args.
 */
p.compare = function(file, solution, callback) {
    this.run(file, async (err, result) => {
        if (err) {
            return callback(err);
        }
        if (this.hasWebGL) {
            const compareResult = await this.compareFrames(solution.webgl, result.webgl, Renderer.WEBGL_TOLERANCE);
            if (compareResult !== true) {
                return callback(new Error(`WebGL results do not match: ${compareResult}.`));
            }
        }
        const compareResult = await this.compareFrames(solution.canvas, result.canvas, Renderer.CANVAS_TOLERANCE);
        if (compareResult !== true) {
            return callback(new Error(`Canvas results do not match: ${compareResult}.`));
        }
        callback(null, true);
    });
};

/**
 * Compare two arrays of frames
 * @method compareFrames
 * @private
 * @param {Array} a
 * @param {Array} b
 * @return {Boolean} If we're equal
 */
p.compareFrames = async function(a, b, tolerance) {
    if (a === b) {
        return true;
    }
    if (a === null || b === null) {
        return 'null render';
    }

    let length = a.length;
    if (b.length !== length) {
        return `unequal length: ${length} : ${b.length}`;
    }

    for (let i=0; i<length; i++) {
        if (a[i].hash !== b[i].hash) {
            if (!await this.imagediff.compare(a[i].image, b[i].image, tolerance)) {
                const renders = document.getElementById('renders-failed');
                renders.innerHTML += '<img width="32" height"32" style="border:1px solid #999" src="'+a[i].image+'">';
                renders.innerHTML += '<img width="32" height"32" style="border:1px solid #999" src="'+b[i].image+'">';
                renders.innerHTML += '&nbsp;&nbsp;';
                return `frame ${i}`;
            }
        }
    }
    return true;
}

module.exports = Renderer;