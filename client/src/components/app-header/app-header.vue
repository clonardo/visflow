<template>
<div>
  <nav class="app-header navbar navbar-expand-sm navbar-light bg-white border-bottom">
    <a id="logo" class="navbar-brand">
      <img src="@/imgs/logo.png">
      <span class="vis">Vis</span>
      <span class="flow">Flow</span>
    </a>
    <b-navbar-toggle target="nav-collapse"></b-navbar-toggle>
    <b-collapse is-nav id="nav-collapse">
      <b-navbar-nav>
        <diagram-menu></diagram-menu>
      </b-navbar-nav>
      <b-navbar-nav>
        <edit-menu></edit-menu>
      </b-navbar-nav>
      <b-navbar-nav>
        <options-menu></options-menu>
      </b-navbar-nav>
      <b-navbar-nav>
        <help-menu></help-menu>
      </b-navbar-nav>
      <history-bar></history-bar>
      <b-navbar-nav class="ml-auto">
        <!-- tool bars -->
        <diagram-bar></diagram-bar>
        <vis-mode-bar></vis-mode-bar>
        <drag-bar></drag-bar>
        <dataset-bar></dataset-bar>
        <flowsense-bar v-if="flowsenseEnabled"></flowsense-bar>

        <user-bar></user-bar>
      </b-navbar-nav>
    </b-collapse>
  </nav>
</div>

</template>

<style scoped lang="scss" src="./app-header.scss"></style>

<script lang="ts" src="./app-header.ts">
</script>
