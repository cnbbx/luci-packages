'use strict';
'require view';
'require ui';
'require form';
'require rpc';

const callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: { '': {} }
});

function getServiceStatus() {
	return L.resolveDefault(callServiceList('xfrpc'), {}).then(function (res) {
		var isRunning = false;
		try {
			isRunning = res['xfrpc']['instances']['instance1']['running'];
		} catch (e) { }
		return isRunning;
	});
}

function renderStatus(isRunning) {
	var renderHTML = "";
	var spanTemp = '<em><span style="color:%s"><strong>%s %s</strong></span></em>';

	if (isRunning) {
		renderHTML += String.format(spanTemp, 'green', _("x-frp Client "), _("RUNNING"));
	} else {
		renderHTML += String.format(spanTemp, 'red', _("x-frp Client "), _("NOT RUNNING"));
	}

	return renderHTML;
}

return view.extend({
	render: function() {
		let m, s, o;

		m = new form.Map('xfrpc', _('xfrpc'));
		m.description = _("xfrpc is a c language frp client for frps.");

		s = m.section(form.NamedSection, '_status');
		s.anonymous = true;
		s.render = function (section_id) {
			L.Poll.add(function () {
				return L.resolveDefault(getServiceStatus()).then(function(res) {
					var view = document.getElementById("service_status");
					view.innerHTML = renderStatus(res);
				});
			});

			return E('div', { class: 'cbi-map' },
				E('fieldset', { class: 'cbi-section'}, [
					E('p', { id: 'service_status' },
						_('Collecting data ...'))
				])
			);
		}

		s = m.section(form.NamedSection, 'common', 'xfrpc');
		s.dynamic = true;

		s.tab('common', _('Common Settings'));
		s.tab('init', _('Startup Settings'));

		o = s.taboption('init', form.Flag, 'enabled', _('Enable xfrpc service'),
			_('Check this to allow xfrpc to start.'));
		o.default = '1';

		o = s.taboption('init', form.ListValue, 'loglevel', _('Log level'),
			'%s <br /> %s'.format(_('LogLevel specifies the minimum log level. Valid values are "Debug", "Info", \
			"Notice", "Warning", "Error", "Critical", "Alert" and "Emergency".'),
			_('By default, this value is "Info".')));
		o.value(8, _('Debug'))
		o.value(7, _('Info'))
		o.value(6, _('Notice'))
		o.value(5, _('Warning'))
		o.value(4, _('Error'))
		o.value(3, _('Critical'))
		o.value(2, _('Alert'))
		o.value(1, _('Emergency'))

		o = s.taboption('common', form.Value, 'server_addr', _('Server address'),
			'%s <br /> %s'.format(_('Server address specifies the address of the server to connect to.'),
			_('By default, this value is "0.0.0.0".')));
		o.datatype = 'host';

		o = s.taboption('common', form.Value, 'server_port', _('Server port'),
			'%s <br /> %s'.format(_('Server port specifies the port to connect to the server on.'),
			_('By default, this value is 7000.')));
		o.datatype = 'port';

		o = s.taboption('common', form.Value, 'token', _('Token'),
			'%s <br /> %s'.format(_('Token specifies the authorization token used to create keys to be \
			sent to the server. The server must have a matching token for authorization to succeed.'),
			_('By default, this value is "".')));

		s = m.section(form.GridSection, 'tcp', _('TCP Proxies'));
		s.addremove = true;
		s.sortable = true;
		s.nodescriptions = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';

		o = s.option(form.ListValue, 'service_type', _('Service type'));
		o.value('', _('None'));
		o.value('ssh');
		o.value('mstsc');
		o.value('rdp');
		o.value('vnc');
		o.value('telnet');
		o.optional = true;

		o = s.option(form.Value, 'local_ip', _('Local IP'),
			_('LocalIp specifies the IP address or host name to proxy to.'));
		o.datatype = 'host';

		o = s.option(form.Value, 'local_port', _('Local port'),
			_('LocalPort specifies the port to proxy to.'));
		o.datatype = 'port';

		o = s.option(form.Value, 'remote_port', _('Remote port'),
			_('If remote_port is 0, frps will assign a random port for you'));
		o.datatype = 'port';

		s = m.section(form.GridSection, 'http', _('HTTP Proxies'));
		s.addremove = true;
		s.sortable = true;
		s.nodescriptions = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';

		o = s.option(form.Value, 'local_ip', _('Local IP'),
			_('LocalIp specifies the IP address or host name to proxy to.'));
		o.datatype = 'host';

		o = s.option(form.Value, 'local_port', _('Local port'),
			_('LocalPort specifies the port to proxy to.'));
		o.datatype = 'port';

		o = s.option(form.Value, 'custom_domains', _('Custom domains'));
		o.optional = true;

		o = s.option(form.Value, 'subdomain', _('Subdomain'));
		o.optional = true;

		s = m.section(form.GridSection, 'https', _('HTTPS Proxies'));
		s.addremove = true;
		s.sortable = true;
		s.nodescriptions = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';

		o = s.option(form.Value, 'local_ip', _('Local IP'),
			_('LocalIp specifies the IP address or host name to proxy to.'));
		o.datatype = 'host';

		o = s.option(form.Value, 'local_port', _('Local port'),
			_('LocalPort specifies the port to proxy to.'));
		o.datatype = 'port';

		o = s.option(form.Value, 'custom_domains', _('Custom domains'));
		o.optional = true;

		o = s.option(form.Value, 'subdomain', _('Subdomain'));
		o.optional = true;

		s = m.section(form.GridSection, 'socks5', _('SOCKS5 Proxies'));
		s.addremove = true;
		s.sortable = true;
		s.nodescriptions = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';

		o = s.option(form.Value, 'remote_port', _('Remote port'),
			_('If remote_port is 0, frps will assign a random port for you'));
		o.datatype = 'port';

		return m.render();
	}
});
