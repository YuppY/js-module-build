# Javascript Module Builder

Tool for building javascript library by processing special directives:

```javascript
// #directive argument

/*
    #multiline-directive
        argument1,
        argument2
*/
```

## `#import` directive

Declares module or library dependency. Syntax:

```
#import module1[ as alias1][, module2[ as alias2]...]
```

Imported modules running in local namespace with help of IIFE. For example `lib.js`:

```javascript
// #import some_module

var value = module.doSomething();
console.log(value);
```

`some_module.js`:
```javascript
var some_module = {
    doSomething: function () {
        return Math.random();
    }
};
```

Resulting library:

```javascript
(function () {
    var __module_0 = (function () {

/* begin: some_module.js */
var some_module = {
    doSomething: function () {
        return Math.random();
    }
};
/* end: some_module.js */

        if (typeof some_module !== 'undefined') { return some_module }
    }());
    (function (some_module) {

/* begin */
var value = some_module.doSomething();
console.log(value);
/* end */

    }(__module_0));
}());
```
