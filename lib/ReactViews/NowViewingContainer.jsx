'use strict';
const React = require('react');
const NowViewingItem = require('./NowViewingItem.jsx');
const defined = require('terriajs-cesium/Source/Core/defined');

const NowViewingContainer = React.createClass({
    propTypes: {
        nowViewing: React.PropTypes.array,
        toggleModalWindow: React.PropTypes.func,
        setPreview: React.PropTypes.func
    },

    getInitialState() {
        return {
            placeholderIndex: -1,
            draggedItemIndex: -1,
            items: this.props.nowViewing,
            selectedItem: null
        };
    },

    onDragStart(e) {
        if (defined(e.dataTransfer)) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text', 'Dragging a Now Viewing item.');
        }
        else {
            e.originalEvent.dataTransfer.effectAllowed = 'move';
            e.originalEvent.dataTransfer.setData('text', 'Dragging a Now Viewing item.');
        }

        const _draggedItemIndex = parseInt(e.currentTarget.dataset.key, 10);

        this.setState({
            draggedItemIndex: _draggedItemIndex,
            selectedItem: this.state.items[_draggedItemIndex]
        });
    },

    onDragEnd(e) {
        if(e.dataTransfer.dropEffect === 'move') {
            this.state.items.splice(this.state.draggedItemIndex, 1);
            this.state.draggedItemIndex = -1;
            this.state.placeholderIndex = -1;
            this.setState(this.state);
            return;
        }
        if(this.state.placeholderIndex !== -1 || this.state.draggedItemIndex !== -1) {
            this.setState({
                placeholderIndex: -1,
                draggedItemIndex: -1
            });
        }
    },

    onDragOverDropZone(e) {
        const _placeholderIndex = parseInt(e.currentTarget.dataset.key, 10);
        if(_placeholderIndex !== this.state.placeholderIndex) { this.setState({ placeholderIndex: _placeholderIndex });}
        e.preventDefault();
    },

    onDragOverItem(e) {
        let over = parseInt(e.currentTarget.dataset.key, 10);
        if(e.clientY - e.currentTarget.offsetTop > e.currentTarget.offsetHeight / 2) { over++; }
        if(over !== this.state.placeholderIndex) { this.setState({ placeholderIndex: over }); }
        e.preventDefault();
    },

    onDrop(e) {
        if(this.state.placeholderIndex !== -1) {
            this.state.items.splice(this.state.placeholderIndex, 0, this.state.selectedItem);
            if(this.state.draggedItemIndex > this.state.placeholderIndex) {
                this.state.draggedItemIndex = this.state.draggedItemIndex + 1;
            }
            this.state.placeholderIndex = -1;
            this.setState(this.state);
        }
    },

    onDragLeaveContainer(e) {
        const x = e.clientX;
        const y = e.clientY;
        const top = e.currentTarget.offsetTop;
        const bottom = top + e.currentTarget.offsetHeight;
        const left = e.currentTarget.offsetLeft;
        const right = left + e.currentTarget.offsetWidth;
        if(y <= top || y >= bottom || x <= left || x >= right) { this.resetHover(); }
    },

    resetHover(e) {
        if(this.state.placeholderIndex !== -1) {
            this.setState({ placeholderIndex: -1 });
        }
    },

    renderNowViewingItem(item, i) {
        return <NowViewingItem nowViewingItem={item}
                               toggleModalWindow={this.props.toggleModalWindow}
                               index={i} key={'placeholder-' + i}
                               dragging={this.state.draggedItemIndex === i}
                               onDragOver={this.onDragOverItem}
                               onDragStart={this.onDragStart}
                               onDragEnd={this.onDragEnd}
                               setPreview={this.props.setPreview}
                />;
    },

    renderPlaceholder(i) {
        return <li className={(this.state.placeholderIndex === i) ? 'nowViewing__drop-zone is-active' : 'nowViewing__drop-zone'} data-key={i} key={i} onDragOver={this.onDragOverDropZone} ></li>;
    },

    renderListElements() {
        const items = [];
        let i;

        for(i = 0; i < this.state.items.length; i++) {
            items.push(this.renderPlaceholder(i));
            items.push(this.renderNowViewingItem(this.state.items[i], i));
        }
        items.push(this.renderPlaceholder(i));
        return items;
    },

    render() {
        return <ul className="now-viewing__content list-reset" onDragLeave={this.onDragLeaveContainer} onDrop={this.onDrop}>
              {this.renderListElements()}
              </ul>;
    }
});
module.exports = NowViewingContainer;
