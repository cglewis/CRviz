'use strict';

var deepProp = R.curry(function(props, obj) {
  return R.pipe.apply(null, R.map(R.prop, props))(obj);
});

function getLeaves(nestingNode) {
  if (!nestingNode.values) {
    return nestingNode;
  }
  return R.chain(function(child) {
    if (child.values) {
      return R.chain(getLeaves, child.values)
    } else {
      return child;
    }
  }, nestingNode.values)
}


function nestChildren(groupOrder, children, depth) {
  return R.chain(function(child) {
    if (child.key === 'Unknown') {
      return R.chain(getLeaves, child.values);
    }
    return [nestingToHierarchy(groupOrder, child, depth + 1)]
  }, children)
}

function nestingToHierarchy(groupOrder, nesting, depth) {
  if (depth === 0) {
    return {
      groupValue: null,
      type: null,
      children: nestChildren(groupOrder, nesting, depth)
    };
  } else if (nesting.values) {
    return {
      groupValue: nesting.key,
      type: groupOrder[depth - 1].join('_'),
      children: nestChildren(groupOrder, nesting.values, depth)
    };
  } else {
    return nesting;
  }
}

function rotate(array, offset) {
  return R.concat(R.drop(offset, array), R.reverse(R.take(offset, array)));
}


// var groupOrder = [['netmask']].concat(rotate([ ['os', 'os'], ['role', 'role']], offset));
var groupOrder = [['netmask'], ['os', 'os'], ['role', 'role']];

function rotateAll() {
  groupOrder = rotate(groupOrder, 1)
}

function rotateChildren() {
  groupOrder = [groupOrder[0]].concat(rotate(R.tail(groupOrder), 1));
}


function makeHierarchy() {
  // var groupOrder = rotate([ ['netmask'], ['os', 'os'], ['role', 'role']], offset);

  d3.select('#groupOrder').text(R.join(' > ', R.map(R.join('_'), groupOrder)));

  var deepNest = R.reduce(function(nest, currentKey) {
    return nest.key(function(d) { return deepProp(currentKey, d); });
  }, d3.nest())

  var nest = deepNest(groupOrder).entries(DATA);

  return nestingToHierarchy(groupOrder, nest, 0);
}

function render() {

  var width = document.documentElement.clientWidth;
  var height = document.documentElement.clientHeight;

  // State
  var view = null;

  var svg = d3.select("svg")
    .attr('width', width)
    .attr('height', height)

  d3.select('#rotate')
    .on('click', function() {
      rotateAll();
      update(makeHierarchy())
    });

  d3.select('#rotateChildren')
    .on('click', function() {
      rotateChildren();
      update(makeHierarchy())
    });

  d3.select('#changePlacement')
    .on('click', function() {
      changePlacement();
      update(makeHierarchy());
    });

  var g = svg.append("g");

  var selectedNode = null;
  var currentView = null;

  function update(hierarchy) {
    var root = d3.hierarchy(hierarchy)
      .count()
      .sort(function(a, b) {
        if (a.children && b.children) {
          return b.value - a.value;
        } else if (!a.children && !b.children) {
          return a.data["IP"].localeCompare(b.data["IP"]);
        } else {
          return a.children ? -1 : 1;
        }
      })

    var pack = packWithLabel()
      .size([ width, height ])
      .padding(function(d) { return Math.log(d.height) * 5 + 1; });

    var packedRoot = pack(root);

    var quadtree = d3.quadtree(packedRoot.descendants(), R.prop('x'), R.prop('y'));

    var node = g.selectAll('g')
      .data(packedRoot.descendants(), datumKey);

    node.exit().remove();

    var nodeEnter = node.enter()
      .append('g')
      .attr('data-key', datumKey )
      .attr('data-row', R.prop('row'))

    appendCircle(nodeEnter, function(d) {
      zoom(d);
    });

    node.merge(nodeEnter)
      .on('click', function(d) {
        zoom(d);
        d3.event.stopPropagation();
      })

    if (selectedNode) {
      selectedNode = walkTree(packedRoot, R.map(datumKey, R.reverse(selectedNode.ancestors())))
    } else {
      selectedNode = packedRoot;
    }

    zoomTo(
      node.transition().duration(500),
      viewFromFocus(selectedNode));
    zoomTo(nodeEnter, viewFromFocus(selectedNode));

    function zoom(d) {
      selectedNode = d;

      var newView = viewFromFocus(d);

      var hRatio = Math.max(width / height, 1)
      var vRatio = Math.max(height / width, 1)

      var searchBound = [
        newView[0] - (newView[2] * hRatio / 2),
        newView[1] - (newView[2] * vRatio/ 2),
        newView[0] + (newView[2] * hRatio / 2),
        newView[1] + (newView[2] * vRatio/ 2),
      ];

      var visibleData = searchQuadtree(quadtree, searchBound);

      visibleData = R.chain(function(node) {
        return [node].concat(node.ancestors());
      }, visibleData);


      var visibleData = new Set(R.map(datumKey, visibleData));

      var visibleNode = node.merge(nodeEnter)
        .filter(function(datum) {
          return (visibleData.has(datumKey(datum)));
        })

      var hiddenNode = node.merge(nodeEnter)
        .filter(function(datum) {
          return !(visibleData.has(datumKey(datum)));
        })
        .style('opacity', 0)
        .attr('hidden', true)


      var nodeToAnimate = visibleNode.filter(function() {
        return !this.hasAttribute('hidden');
      })

      var interpolate = d3.interpolateZoom(view, newView);
      d3.transition()
        .duration(interpolate.duration)
        .tween('zoom', function() {
          return function(t) {
            zoomTo(nodeToAnimate, interpolate(t))
          }
        })
        .on('end', function() {
          visibleNode
            .attr('hidden', null)
            .filter(function() {
              return Math.max(parseFloat(this.style.opacity), 0) === 0
            })
            .transition().duration(500)
            .style('opacity', 1)
          zoomTo(visibleNode, newView);
        });
    }

    // Scale and translate the given node(s) for the 'zoom' and 'pan'
    // effect.
    function zoomTo(node, newView) {
      var k = Math.min(width, height) / newView[2];
      var center = [width / 2, height / 2];

      view = newView;

      var k = Math.min(width, height) / view[2];

      var center = [width / 2, height / 2];

      node.attr("transform", function(d) {
        return "translate(" + ((d.x - view[0]) * k + center[0]) + "," + ((d.y - view[1]) * k + center[1]) + ")";
      });

      node.attr('hidden', function(d) {
        if (d.r * 2 * k < 1) {
          return true;
        }
        return null;
      });

      node.select('circle')
        .attr("r", function(d) { return d.r * k; })

      displayLabel(node, newView);

      node.select('.label-shape')
        .attr('d', function(d) {
          var top = (d.r - d.labelSize) * k;
          var radius = d.r * k;

          var startX = 0 - Math.sqrt(radius * radius - top * top);
          var startY = top;

          var startAngle = Math.PI / 2 + Math.acos(top / radius);
          var endAngle = Math.PI / 2 - Math.acos(top / radius);

          var shape = d3.path();
          shape.arc(0, 0, radius, startAngle, endAngle, true);
          shape.closePath();
          return shape.toString();
        })
    }

    function displayLabel(node, newView) {
      var k = Math.min(width, height) / newView[2];

      node.select('.label')
        .attr('y', function calcLabelPos(d) {
          return d.r * k - (d.labelSize * k) / 2;
        })
        .attr('pointer-events', 'none')
        .attr('hidden', function calcLabelOpacity(d) {
          var $this = d3.select(this);
          var radius = d.r * k;
          var height = 14;
          var width = this.getComputedTextLength();
          var bottom = parseFloat($this.attr('y')) + height;
          var chordLength = 1.9 * Math.sqrt(radius * radius - bottom * bottom)
          if (width <= chordLength && height <= d.labelSize * k) {
            if (d.data.groupValue === '10.102.78.0/24') {
              console.log('show', width, chordLength, height, d.labelSize * k)
            }
            return null;
          } else {
            if (d.data.groupValue === '10.102.78.0/24') {
              console.log('hide', width, chordLength, height, d.labelSize * k)
            }
            return true;
          }
        })
    }
  }

  changePlacement();
  update(makeHierarchy());
}

render();