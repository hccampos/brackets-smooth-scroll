/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, $, brackets */

/** 
 * Brackets Smooth Scroll Extension 
 */
define(function (require, exports, module) {
    'use strict';
    
    // How much the force is increased/decreased (at least) per scroll event.
    var STEP = 0.00001;
    // How much the force is to be reduced each 16 ms (60fps). For instance, if the value is 0.8,
    // after 16ms the force will be 80% of what is was initially, after 32ms it will be 0.64% of
    // the initial value, and so on.
    var FORCE_REDUCTION_FACTOR = 0.8;
    // Same as above but to reduce the speed of the page in order to simulate some kind of drag or
    // friction.
    var PSEUDO_FRICTION = 0.93;
    // Maximum magnitude of the force that can be applied to the page.
    var MAX_FORCE = 0.02;
    // If the speed of the page goes below this value, we just won't update the scroll position and
    // we will stop the page.
    var SPEED_THRESHOLD = 0.001;
    
    // Local variables. No need to mess with these.
    var EditorManager  = brackets.getModule("editor/EditorManager");
    var DocumentManager = brackets.getModule("document/DocumentManager");
    var $scroller = null;
    var scrollerElement = null;
    var velocity = 0.0;
    var force = 0.0;
    var isAnimating = false;
    var lastUpdate = 0;
    var lastScroll = 0;
    var lastPosition = 0;
    
    /**
     * Function which is called each frame to update the scroll position of the page.
     * 
     * @param {number} timestamp
     *      The current time.
     */
    function update(timestamp) {
        if (!isAnimating) { return; }

        // If this is the first update, just get the current time and reqest another update.
        if (lastUpdate === 0.0) {
            lastUpdate = timestamp;
            return requestAnimationFrame(update);
        }
        
        // Determine how much time has passed since the last update (in milliseconds).
        var elapsedTime = timestamp - lastUpdate;
        lastUpdate = timestamp;
        
        // This is used below. We use this exponent because the values were determine for 60 fps
        // 1000 milliseconds / 60 is about 16 milliseconds. So say that it was 32 milliseconds
        // since the last update, we would need to have PSEUDO_FRICTION^2 and 
        // FORCE_REDUCTION_FACTOR^2 because 32/16 = 2. It would be equivalent of having had two
        // updates 16 ms appart.
        var exp = elapsedTime / 16.0;
        
        // Decrease the magnitude of the force, otherwise the page will never stop accelerating.
        force *= Math.pow(FORCE_REDUCTION_FACTOR, exp);
        // Accelerate, because Newton.
        velocity += force * elapsedTime;
        // Add some simulated drag/friction... not realistic but works (still, don't show it to 
        // Newton).
        velocity *= Math.pow(PSEUDO_FRICTION, exp);
        
        // Check if the speed is above a certain threshold. If not, we don't need to bother
        // setting the scroll postion (with the associated style calculations, layouts, etc) and
        // we just stop the motion of the page.
        if (Math.abs(velocity) > SPEED_THRESHOLD) {
            var newPosition = Math.round(scrollerElement.scrollTop + velocity * elapsedTime);
            
            if (scrollerElement && newPosition !== lastPosition) {
                scrollerElement.scrollTop = newPosition;
                lastPosition = newPosition;
            }
        } else {
            velocity = 0.0;
        }
        
        // Don't exit the function without reqesting another update or the page won't move.
        return requestAnimationFrame(update);
    }
    
    /**
     * Starts animating the page.
     */
    function startAnimating() {
        isAnimating = true;
        requestAnimationFrame(update);
    }
    
    /**
     * Stops animating the page.
     */
    function stopAnimating() {
        isAnimating = false;
    }
     
    /**
     * This is our scroll event handler.
     */
    function onScroll(event) {
        event.preventDefault();
        event.stopPropagation();
        
        // If this is the first scroll, just get the current time and wait for another event.
        if (lastScroll === 0) {
            lastScroll = window.performance.now();
            return;
        }
        
        // Determine how much time has passed since the last scroll event.
        var currentTime = window.performance.now();
        var elapsedTime = currentTime - lastScroll;
        lastScroll = currentTime;
        
        if (elapsedTime === 0.0) { return; }

        // Get the wheel delta from the original webkit event.
        var wheelDelta = -event.originalEvent.wheelDeltaY;
        
        var sameDirection = velocity * wheelDelta >= 0.0; // -1*1 = -1 and -1*-1 = 1 so yea.
        
        // If we are scrolling in the same direction as the page is moving, we change the force
        // being applied. Otherwise, we want the page to stop so we reset the force and the 
        // velocity to zero. This way the user can scroll fast in one direction and then just 
        // scroll one click in the opposite direction to stop the page.
        if (sameDirection) {
            var currentStep = wheelDelta * STEP;
            // Add to the force being applied to the page. Note that the less time that has passed
            // since the last scroll event, the more the force will be increased/decreased.
            force += currentStep + currentStep / (elapsedTime * 0.002);
            
            // Make sure we don't apply a ridiculous force... this is not star wars.
            var forceMagnitude = Math.abs(force);
            if (forceMagnitude > MAX_FORCE) { force *= MAX_FORCE / forceMagnitude; }
        } else {
            force = 0.0;
            velocity = 0.0;
        }
    }
    
    /**
     * Registers all the event listeners we need.
     */
    function addListeners() {
        if (!$scroller) { return; }
        $scroller.on('mousewheel.smoothscroll', onScroll);
    }
    
    /**
     * Removes any event listeners that we may have set up.
     */
    function removeListeners() {
        if (!$scroller) { return; }
        $scroller.off('mousewheel.smoothscroll', onScroll);
    }
    
    /**
     * Function which is called when the current document is changed.
     */
    function onDocumentChanged() {
        // Stop animating because we may not have a new file.
        stopAnimating();
        
        // Reset all the animation variables.
        force = 0.0;
        velocity = 0.0;
        lastScroll = 0;
        lastUpdate = 0;
        
        // And of course, get rid of the listeners to prevent leaks.
        removeListeners();
        
        $scroller = null;
        scrollerElement = null;
        
        // Get the editor for the new file and start everything again: listeners, animation, etc.
        var editor = EditorManager.getCurrentFullEditor();
        if (editor) {
            // This tells code mirror to render a larger part of the document. Having a larger
            // part of the document rendered means there will be less flickering while scrolling
            // at the expense of some extra load time for the file and maybe some pauses once in
            // a while when codemirror has to render other parts of the file. This could be set to
            // infinity in order to have the whole file rendered at once. For small files that
            // provides the smoothest scrolling experince, but for larger files, the performance
            // starts to take a big hit.
            editor._codeMirror.setOption('viewportMargin', 80); 
            
            scrollerElement = editor._codeMirror.display.scroller;
            $scroller = $(scrollerElement);  
        
            addListeners();
            startAnimating();
        }
    }
    
    //---------------------------------------------------------------------------------------------//
        
    $(DocumentManager).on('currentDocumentChange.smoothscroll', onDocumentChanged);
});
