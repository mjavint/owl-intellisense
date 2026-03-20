// @ts-nocheck — fixture file for parser tests; @odoo/owl is not installed as a dev dep
import { Component, useState, onMounted } from '@odoo/owl';

export class NavBar extends Component {
  static template = 'NavBar';
  static props = {
    title: String,
    collapsed: { type: Boolean, optional: true },
  };

  setup() {
    this.state = useState({ open: false });
    onMounted(() => {
      console.log('NavBar mounted');
    });
  }
}

export class CounterWidget extends Component {
  static template = 'CounterWidget';
  static props = {
    initialCount: Number,
    label: String,
    onReset: { type: Function, optional: true },
  };

  setup() {
    this.count = useState({ value: this.props.initialCount });
  }
}

export class SimpleButton extends Component {
  static template = 'SimpleButton';
  static props = {};

  setup() {}
}
